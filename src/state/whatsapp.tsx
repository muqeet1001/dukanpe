import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { BotConnection, BotSnapshot, botRequest, connectionFrom, validateSnapshot } from '../lib/bot-api';
import { useBusiness } from './business';

const KEY = 'dukanpe-bot-connection-v1';
type WhatsAppContextValue = { connection: BotConnection | null; snapshot: BotSnapshot | null; error: string | null;
  pair: (url: string, token: string) => Promise<void>; disconnect: () => Promise<void>; refresh: () => Promise<void>;
  request: <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T> };
const Context = createContext<WhatsAppContextValue | null>(null);
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
  const revision = useRef(0);
  const accept = useCallback((data: BotSnapshot) => {
    const checked = validateSnapshot(data);
    setSnapshot(checked); setError(null);
    dispatch({ type: 'import-whatsapp', parties: checked.parties, records: checked.records });
  }, [dispatch]);
  useEffect(() => {
    let active = true;
    readConnection().then((raw) => {
      if (!active || !raw) return;
      const saved = JSON.parse(raw) as BotConnection;
      setConnection(connectionFrom(saved.url, saved.token));
    }).catch(() => { if (active) setError('Saved bot pairing is unavailable. Pair the app again.'); });
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
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'Bot sync failed.'); }
      if (active) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [ready, connection, accept]);
  const pair = async (url: string, token: string) => {
    const config = connectionFrom(url, token);
    const data = validateSnapshot(await botRequest<BotSnapshot>(config, '/api/snapshot'));
    await saveConnection(config); revision.current++; setConnection(config); accept(data);
  };
  const disconnect = async () => { await saveConnection(null); revision.current++; setConnection(null); setSnapshot(null); setError(null); };
  const request = async <T,>(path: string, options?: { method?: string; body?: unknown }): Promise<T> => {
    if (!connection) throw new Error('Pair the app with the bot server first.');
    return botRequest<T>(connection, path, options);
  };
  return <Context.Provider value={{ connection, snapshot, error, pair, disconnect, refresh, request }}>{children}</Context.Provider>;
}
export function useWhatsApp() { const context = useContext(Context); if (!context) throw new Error('WhatsAppProvider is required'); return context; }
