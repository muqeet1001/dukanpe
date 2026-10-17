import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { BusinessRecord, Party } from './domain';

export type BotConnection = { url: string; token: string };
export type Product = { id: string; name: string; unit: string; pricePaise: number; aliases: string[] };
export type InvoiceItem = { productId: string; name: string; unit: string; quantityMilli: number; unitPricePaise: number; totalPaise: number };
export type BotInvoice = { id: string; number: string; customerId: string; customerName: string; customerPhone: string; createdAt: string;
  items: InvoiceItem[]; totalPaise: number; balanceAfterPaise: number; sourceMessageId: string; sourceBody: string; isDemo: boolean;
  delivery: 'demo' | 'pending' | 'sending' | 'sent' | 'uncertain'; deliveryError: string | null; paymentStatus: 'unpaid' };
export type BotStatus = { state: 'idle' | 'starting' | 'qr' | 'authenticating' | 'connected' | 'disconnected' | 'error'; qr: string | null; error: string | null; lastIncomingAt?: string; lastReplyAt?: string };
export type BotSnapshot = { shopName: string; status: BotStatus; catalogue: Product[]; invoices: BotInvoice[]; parties: Party[]; records: BusinessRecord[] };
export type DemoResult = { reply: string; invoice: BotInvoice | null; duplicate: boolean };

export function defaultBotUrl() {
  if (process.env.EXPO_PUBLIC_BOT_URL) return process.env.EXPO_PUBLIC_BOT_URL;
  if (Platform.OS === 'web') return 'http://localhost:4000';
  const host = Constants.expoConfig?.hostUri;
  if (host) { try { return `http://${new URL('http://' + host).hostname}:4000`; } catch { /* Use the editable fallback. */ } }
  return 'http://localhost:4000';
}
export function connectionFrom(url: string, token: string): BotConnection {
  const parsed = new URL(url.trim());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Use a server address like http://192.168.1.10:4000.');
  if (token.trim().length < 24 || token.trim().length > 200) throw new Error('Paste the pairing code from the bot server.');
  return { url: parsed.origin, token: token.trim() };
}
export async function botRequest<T>(connection: BotConnection, path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(connection.url + path, { method: options.method ?? 'GET', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Bot request failed.');
    return data as T;
  } catch (error) {
    if (error instanceof Error && /abort|network|fetch/i.test(error.message)) throw new Error('Cannot reach the bot. Check its server address and Wi-Fi connection.');
    throw error;
  } finally { clearTimeout(timer); }
}
export function validateSnapshot(data: BotSnapshot): BotSnapshot {
  if (!data || typeof data.shopName !== 'string' || !data.status || !['idle', 'starting', 'qr', 'authenticating', 'connected', 'disconnected', 'error'].includes(data.status.state)
    || (data.status.qr !== null && (typeof data.status.qr !== 'string' || !data.status.qr.startsWith('data:image/png;base64,')))
    || (data.status.error !== null && typeof data.status.error !== 'string')
    || [data.status.lastIncomingAt, data.status.lastReplyAt].some((value) => value !== undefined && (typeof value !== 'string' || !Number.isFinite(Date.parse(value))))
    || !Array.isArray(data.parties) || !Array.isArray(data.records) || !Array.isArray(data.invoices) || !Array.isArray(data.catalogue)
    || !data.parties.every((p) => typeof p.id === 'string' && p.id.startsWith('wa-customer-') && typeof p.name === 'string' && typeof p.initials === 'string' && typeof p.note === 'string' && p.openingBalancePaise === 0)
    || !data.records.every((r) => typeof r.id === 'string' && typeof r.title === 'string' && typeof r.subtitle === 'string' && typeof r.evidence === 'string' && typeof r.createdAt === 'string')
    || !data.catalogue.every((p) => typeof p.id === 'string' && typeof p.name === 'string' && typeof p.unit === 'string' && Number.isSafeInteger(p.pricePaise))
    || !data.invoices.every((i) => typeof i.id === 'string' && typeof i.number === 'string' && typeof i.customerName === 'string' && Number.isSafeInteger(i.totalPaise) && Number.isSafeInteger(i.balanceAfterPaise)
      && Array.isArray(i.items) && i.items.every((line) => typeof line.name === 'string' && typeof line.unit === 'string' && Number.isSafeInteger(line.quantityMilli) && Number.isSafeInteger(line.totalPaise)))) throw new Error('The server returned an invalid bot snapshot.');
  return data;
}
