import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Store } from './store.js';
import { MongoStore } from './mongo-store.js';
import { GroqAI } from './groq.js';
import { WhatsAppAssistant } from './assistant.js';
import { PaymentService } from './payments.js';
import { WhatsAppBot } from './whatsapp.js';
import { createApi } from './api.js';
import { DeviceAccess, DirectWhatsAppLink } from './direct-link.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDirectory = join(root, 'data');
mkdirSync(dataDirectory, { recursive: true });
const pairingFile = join(dataDirectory, 'pairing-code.txt');
if (!existsSync(pairingFile)) writeFileSync(pairingFile, randomBytes(24).toString('base64url'), { mode: 0o600 });
const token = readFileSync(pairingFile, 'utf8').trim();
if (token.length < 24) throw new Error('Invalid server pairing code. Use at least 24 characters.');
const catalogue = JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8'));
const shopName = process.env.SHOP_NAME || 'Dukanpe';
let store;
try {
  store = process.env.MONGODB_URI
    ? await MongoStore.connect(process.env.MONGODB_URI, process.env.MONGODB_DB || undefined, catalogue, shopName)
    : new Store(join(dataDirectory, 'dukanpe.sqlite'), catalogue, shopName);
} catch { console.error('Database connection failed. Check server/.env, Atlas credentials and network access.'); process.exit(1); }
const ai = new GroqAI({ apiKey: process.env.AI_PROVIDER === 'off' ? '' : process.env.GROQ_API_KEY });
const payments = new PaymentService(store, dataDirectory, { upiId: process.env.MERCHANT_UPI_ID || '' });
const assistant = new WhatsAppAssistant(store, ai, payments);
const bot = new WhatsAppBot(store, dataDirectory, { assistant, payments });
const deviceAccess = new DeviceAccess(dataDirectory);
const directLink = new DirectWhatsAppLink(bot, deviceAccess);
const app = createApi({ store, bot, token, assistant, payments, deviceAccess, directLink, extraOrigins: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean) });
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Dukanpe bot API: http://localhost:${port}`);
  console.log(`Storage: ${process.env.MONGODB_URI ? 'MongoDB' : 'Local SQLite'} · AI: ${ai.enabled ? 'Groq / ' + ai.model : 'Not configured (catalogue commands still work)'}`);
  for (const entries of Object.values(networkInterfaces())) for (const item of entries || []) if (item.family === 'IPv4' && !item.internal) console.log(`Phone API URL: http://${item.address}:${port}`);
  console.log(`Pairing code file: ${pairingFile}`);
  console.log('Open Khata > Connect WhatsApp. Scan the displayed QR inside the merchant WhatsApp Linked devices screen.');
  if (bot.shouldResume) void bot.start().catch(() => { bot.status = { state: 'error', qr: null, error: 'Automatic WhatsApp reconnection failed. Choose Connect WhatsApp to retry.' }; });
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await directLink.clear();
  await bot.stop({ preserveEnabled: true });
  server.close(async () => { await store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', close); process.on('SIGTERM', close);
