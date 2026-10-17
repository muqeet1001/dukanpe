import { existsSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { invoiceText } from './orders.js';
import { invoicePdf } from './invoice-pdf.js';

export class WhatsAppBot {
  constructor(store, dataDirectory, options = {}) {
    this.store = store; this.dataDirectory = dataDirectory; this.options = options;
    this.client = null; this.status = { state: 'idle', qr: null, error: null }; this.queue = Promise.resolve();
  }
  enqueue(task) { this.queue = this.queue.then(task).catch(() => { this.status.error = 'An order could not be processed. Check the server and retry from the app.'; }); return this.queue; }
  async start() {
    if (this.client) return;
    this.status = { state: 'starting', qr: null, error: null };
    const { default: library } = await import('whatsapp-web.js');
    this.library = library;
    const candidates = [process.env.CHROME_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
    const executablePath = candidates.find((path) => path && existsSync(path));
    const client = new library.Client({ authStrategy: new library.LocalAuth({ clientId: 'dukanpe', dataPath: join(this.dataDirectory, 'whatsapp-session') }),
      webVersionCache: { type: 'local', path: join(this.dataDirectory, 'web-cache') }, puppeteer: { headless: true, ...(executablePath ? { executablePath } : {}) } });
    this.client = client;
    client.on('qr', async (value) => {
      const qr = await QRCode.toDataURL(value, { margin: 4, width: 320 });
      if (this.client === client) this.status = { state: 'qr', qr, error: null };
    });
    client.on('authenticated', () => { if (this.client === client) this.status = { state: 'authenticating', qr: null, error: null }; });
    client.on('ready', () => {
      if (this.client !== client) return;
      this.connectedAt = Date.now(); this.status = { state: 'connected', qr: null, error: null };
      for (const id of this.store.pending()) this.enqueue(() => this.deliver(id));
    });
    client.on('auth_failure', () => { if (this.client === client) this.status = { state: 'error', qr: null, error: 'WhatsApp authentication failed. Stop the connection and link again.' }; });
    client.on('disconnected', () => { if (this.client === client) this.status = { state: 'disconnected', qr: null, error: 'WhatsApp disconnected. Stop and restart to reconnect.' }; });
    client.on('message', (message) => {
      if (this.client !== client || message.fromMe || message.broadcast || message.type !== 'chat' || !/@(?:c\.us|lid)$/.test(message.from)
        || !this.connectedAt || message.timestamp * 1000 < this.connectedAt - 30000) return;
      this.enqueue(async () => {
        const contact = await message.getContact().catch(() => null);
        const mapping = message.from.endsWith('@lid') ? await client.getContactLidAndPhone([message.from]).catch(() => []) : [];
        const candidate = mapping[0]?.pn?.replace(/@c\.us$/, '') || (message.from.endsWith('@c.us') ? message.from.split('@')[0] : '');
        const phone = /^\d{7,15}$/.test(candidate) ? candidate : '';
        const result = this.store.process({ messageId: message.id._serialized, customerKey: phone || message.from, chatId: message.from,
          name: contact?.pushname || contact?.name || phone || 'WhatsApp customer', phone, body: message.body });
        if (result.invoice) await this.deliver(result.invoice.id);
        else if (!result.duplicate) await client.sendMessage(message.from, result.reply, { sendSeen: false });
      });
    });
    client.initialize().catch(() => { if (this.client === client) this.status = { state: 'error', qr: null, error: 'WhatsApp could not start. Check Chrome installation and the server setup guide.' }; });
  }
  async deliver(id, retry = false) {
    const invoice = this.store.invoice(id);
    if (!invoice || invoice.isDemo || invoice.delivery === 'sent' || invoice.delivery === 'sending') return;
    if (!retry && invoice.delivery !== 'pending') return;
    if (this.status.state !== 'connected' || !this.client) throw new Error('Connect WhatsApp before sending an invoice.');
    // Generate before marking sending: rendering errors never become ambiguous delivery.
    const pdf = await invoicePdf(invoice, this.store.shopName);
    this.store.delivery(id, 'sending');
    try {
      const media = new this.library.MessageMedia('application/pdf', pdf.toString('base64'), invoice.number + '.pdf');
      const sent = await this.client.sendMessage(invoice.destination, media, { caption: invoiceText(invoice, this.store.shopName), sendMediaAsDocument: true, sendSeen: false });
      this.store.delivery(id, 'sent', null, sent.id._serialized);
    } catch {
      this.store.delivery(id, 'uncertain', 'Delivery could not be confirmed. Check the customer chat before resending. Khata was added only once.');
    }
  }
  async stop() {
    const client = this.client; this.client = null; this.connectedAt = null;
    if (client) await client.destroy().catch(() => undefined);
    this.status = { state: 'idle', qr: null, error: null };
  }
}
