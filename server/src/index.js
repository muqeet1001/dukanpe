import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Store } from './store.js';
import { WhatsAppBot } from './whatsapp.js';
import { createApi } from './api.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDirectory = join(root, 'data');
mkdirSync(dataDirectory, { recursive: true });
const pairingFile = join(dataDirectory, 'pairing-code.txt');
if (!existsSync(pairingFile)) writeFileSync(pairingFile, randomBytes(24).toString('base64url'), { mode: 0o600 });
const token = readFileSync(pairingFile, 'utf8').trim();
if (token.length < 24) throw new Error('Invalid server pairing code. Use at least 24 characters.');
const store = new Store(join(dataDirectory, 'dukanpe.sqlite'), JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8')), process.env.SHOP_NAME || 'Dukanpe Demo Shop');
const bot = new WhatsAppBot(store, dataDirectory);
const app = createApi({ store, bot, token, extraOrigins: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean) });
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Dukanpe bot API: http://localhost:${port}`);
  for (const entries of Object.values(networkInterfaces())) for (const item of entries || []) if (item.family === 'IPv4' && !item.internal) console.log(`Phone API URL: http://${item.address}:${port}`);
  console.log(`Pairing code file: ${pairingFile}`);
  console.log('Open Khata > WhatsApp orders, pair the app, then choose Link WhatsApp.');
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await bot.stop();
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', close); process.on('SIGTERM', close);
