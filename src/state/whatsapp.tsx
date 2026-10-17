import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { BotConnection, BotSnapshot, botRequest, connectionFrom, defaultBotUrl, validateSnapshot } from '../lib/bot-api';
import { directLinkRequest, LinkReply, LinkRequestError, LinkStatus } from '../lib/direct-link';
import { useBusiness } from './business';

const KEY = 'dukanpe-bot-connection-v1';
const LINK_KEY = 'dukanpe-whatsapp-link-v1';
type PendingLink = { url: string; linkToken: string };
type WhatsAppContextValue = { connection: BotConnection | null; snapshot: BotSnapshot | null; error: string | null;
  restored: boolean; link: LinkStatus | null; connect: (replace?: boolean) => Promise<void>;
  pair: (url: string, token: string) => Promise<void>; disconnect: () => Promise<void>; refresh: () => Promise<void>;
  request: <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T> };
const Context = createContext<WhatsAppContextValue | null>(null);
async function savePending(value: PendingLink | null) {
  if (Platform.OS === 'web') { if (value) globalThis.sessionStorage.setItem(LINK_KEY, JSON.stringify(value)); else globalThis.sessionStorage.removeItem(LINK_KEY); }
  else if (value) await SecureStore.setItemAsync(LINK_KEY, JSON.stringify(value));
  else await SecureStore.deleteItemAsync(LINK_KEY);
}
async function readPending(): Promise<PendingLink | null> {
  const raw = Platform.OS === 'web' ? globalThis.sessionStorage?.getItem(LINK_KEY) : await SecureStore.getItemAsync(LINK_KEY);
  if (!raw) return null;
  try { const pending = JSON.parse(raw); return typeof pending.url === 'string' && /^[A-Za-z0-9_-]{43}$/.test(pending.linkToken) ? pending : null; } catch { return null; }
}
async function readConnection() {
  return Platform.OS === 'web' ? globalThis.sessionStorage?.getItem(KEY) : SecureStore.getItemAsync(KEY);
}
async function saveConnection(connection: BotConnection | null) {
  if (Platform.OS === 'web') { if (connection) globalThis.sessionStorage.setItem(KEY, JSON.stringify(connection)); else globalThis.sessionStorage.removeItem(KEY); }
  else if (connection) await SecureStore.setItemAsync(KEY, JSON.stringify(connection));
  else await SecureStore.deleteItemAsync(KEY);
}
export function WhatsAppProvider({ children }: { children: React.ReactNode }) {
  const { ready, dispatch } = useBusiness();
  const [connection, setConnection] = useState<BotConnection | null>(null);
  const [snapshot, setSnapshot] = useState<BotSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [link, setLink] = useState<LinkStatus | null>(null);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const connecting = useRef<Promise<void> | null>(null);
  const revision = useRef(0);
  const accept = useCallback((data: BotSnapshot) => {
    const checked = validateSnapshot(data);
    setSnapshot(checked); setError(null);
    dispatch({ type: 'import-whatsapp', parties: checked.parties, records: checked.records });
  }, [dispatch]);
  useEffect(() => {
    let active = true;
    readConnection().then(async (raw) => {
      if (!active || !raw) return;
      const saved = JSON.parse(raw) as BotConnection;
      if (saved.url !== new URL(defaultBotUrl()).origin) { await saveConnection(null); return; }
      setConnection(connectionFrom(saved.url, saved.token));
    }).catch(() => { if (active) setError('Saved connection is unavailable. Reconnect WhatsApp.'); })
      .finally(() => { if (active) setRestored(true); });
    return () => { active = false; };
  }, []);
  const refresh = useCallback(async () => {
    if (!connection) return;
    const current = revision.current;
    const data = await botRequest<BotSnapshot>(connection, '/api/snapshot');
    if (revision.current === current) accept(data);
  }, [connection, accept]);
  useEffect(() => {
    if (!ready || !connection) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const current = revision.current;
        const data = await botRequest<BotSnapshot>(connection, '/api/snapshot');
        if (active && revision.current === current) accept(data);
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Shop sync failed.');
          if (reason instanceof Error && /access expired/i.test(reason.message)) { await saveConnection(null); revision.current++; setConnection(null); setSnapshot(null); }
        }
      }
      if (active) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [ready, connection, accept]);
  const pair = useCallback(async (url: string, token: string) => {
    const config = connectionFrom(url, token);
    const data = validateSnapshot(await botRequest<BotSnapshot>(config, '/api/snapshot'));
    await saveConnection(config); revision.current++; setConnection(config); accept(data);
  }, [accept]);
  const applyLink = useCallback(async (result: LinkReply, url: string) => {
    if (result.accessToken) {
      await pair(url, result.accessToken); await savePending(null); setPendingLink(null);
    }
    setLink({ state: result.state, qr: result.qr, error: result.error, expiresAt: result.expiresAt });
  }, [pair]);
  const connect = useCallback(async (replace = false) => {
    if (connecting.current) return connecting.current;
    const work = async () => {
      if (connection) { await botRequest(connection, '/api/whatsapp/start', { method: 'POST' }); await refresh(); return; }
      setError(null); setLink({ state: 'starting', qr: null, error: null });
      const url = new URL(defaultBotUrl()).origin;
      let pending = await readPending(); if (pending?.url !== url) pending = null;
      let result: LinkReply;
      try { result = await directLinkRequest(url, '/connect/whatsapp', pending?.linkToken, replace); }
      catch (reason) {
        if (!(reason instanceof LinkRequestError) || ![401, 409].includes(reason.status)) throw reason;
        await savePending(null); pending = null; result = await directLinkRequest(url, '/connect/whatsapp');
      }
      if (result.linkToken) pending = { url, linkToken: result.linkToken };
      if (pending && !result.accessToken && result.state !== 'busy') { await savePending(pending); setPendingLink(pending); }
      await applyLink(result, url);
    };
    const task = work().catch((reason) => {
      setLink({ state: 'error', qr: null, error: reason instanceof Error ? reason.message : 'WhatsApp could not connect. Please retry.' });
    }).finally(() => { connecting.current = null; });
    connecting.current = task; return task;
  }, [connection, refresh, applyLink]);
  useEffect(() => {
    if (!pendingLink || connection) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await directLinkRequest(pendingLink.url, '/connect/whatsapp/status', pendingLink.linkToken);
        if (!active) return;
        await applyLink(result, pendingLink.url);
        if (['error', 'disconnected', 'busy', 'connected'].includes(result.state)) return;
      } catch (reason) {
        if (!active) return;
        setLink({ state: 'error', qr: null, error: reason instanceof Error ? reason.message : 'Please retry WhatsApp linking.' });
        if (reason instanceof LinkRequestError && [401, 409].includes(reason.status)) { await savePending(null); setPendingLink(null); }
        return;
      }
      if (active) timer = setTimeout(poll, 1500);
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [pendingLink, connection, applyLink]);
  const disconnect = async () => { await saveConnection(null); revision.current++; setConnection(null); setSnapshot(null); setError(null); };
  const request = async <T,>(path: string, options?: { method?: string; body?: unknown }): Promise<T> => {
    if (!connection) throw new Error('Connect the merchant WhatsApp account first.');
    return botRequest<T>(connection, path, options);
  };
  return <Context.Provider value={{ connection, snapshot, error, restored, link, connect, pair, disconnect, refresh, request }}>{children}</Context.Provider>;
}
export function useWhatsApp() { const context = useContext(Context); if (!context) throw new Error('WhatsAppProvider is required'); return context; }
