import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { checkoutText } from './payments.js';
import { chatCommand, invoiceText } from './orders.js';
import { invoicePdf } from './invoice-pdf.js';

export function whatsappMessageId(message) {
  const serialized = [message?.id?._serialized, message?.id?.$1, typeof message?.id === 'string' ? message.id : null]
    .find((value) => typeof value === 'string' && value.length > 0);
  if (serialized) return serialized.length <= 240 ? serialized : 'wa-' + createHash('sha256').update(serialized).digest('hex');
  if (typeof message?.id?.id === 'string' && message.id.id) return 'wa-' + createHash('sha256')
    .update(`${message.from || ''}\0${message.to || ''}\0${message.id.id}`).digest('hex');
  return undefined;
}

export class WhatsAppBot {
  constructor(store, dataDirectory, options = {}) {
    this.store = store; this.dataDirectory = dataDirectory; this.options = options;
    this.client = null; this.status = { state: 'idle', qr: null, error: null }; this.queue = Promise.resolve();
  }
  get shouldResume() { try { return JSON.parse(readFileSync(join(this.dataDirectory, 'whatsapp-enabled.json'), 'utf8')).enabled === true; } catch { return false; } }
  rememberConnection(enabled) { writeFileSync(join(this.dataDirectory, 'whatsapp-enabled.json'), JSON.stringify({ enabled })); }
  reportError(stage, error) {
    this.status.error = stage === 'reply'
      ? 'A message arrived, but the reply could not be confirmed. Send a fresh HI from another phone to try again.'
      : stage === 'invoice' ? 'Invoice delivery could not be confirmed. Check the customer chat before resending from the invoice page.'
        : 'A message could not be processed. Send a fresh HI to try again and check the bot server.';
    // Keep customer messages and contact identifiers out of diagnostic output.
    const detail = String(error?.message || error?.name || 'Unknown error').split('\n')[0]
      .replace(/https?:\/\/\S+|\S+@\S+|\d{7,}|[A-Za-z0-9_-]{32,}/g, '[redacted]').slice(0, 180);
    (this.options.onError || ((context, message) => console.error(`[WhatsApp ${context}] ${message}`)))(stage, detail);
  }
  enqueue(task) {
    this.queue = this.queue.then(task).catch((error) => this.reportError(error?.botStage || 'message', error));
    return this.queue;
  }
  async handleMessage(message, client = this.client) {
    if (!client || this.client !== client || message.fromMe || message.broadcast || !['chat', 'image'].includes(message.type)
      || (message.type === 'image' && !this.options.payments)
      || !/@(?:c\.us|lid)$/.test(message.from) || !this.connectedAt
      || !Number.isFinite(message.timestamp) || message.timestamp * 1000 < this.connectedAt - 30000) return;
    this.status.lastIncomingAt = new Date().toISOString();
    let phone = ''; let name = 'WhatsApp customer';
    // Greetings and menu commands must work even when WhatsApp's contact APIs fail.
    if (!chatCommand(message.body)) {
      const contact = await Promise.resolve().then(() => message.getContact()).catch(() => null);
      const mapping = message.from.endsWith('@lid')
        ? await Promise.resolve().then(() => client.getContactLidAndPhone([message.from])).catch(() => []) : [];
      const candidate = mapping?.[0]?.pn?.replace(/@c\.us$/, '')
        || (message.from.endsWith('@c.us') ? message.from.split('@')[0] : '');
      phone = /^\d{7,15}$/.test(candidate) ? candidate : '';
      name = String(contact?.pushname || contact?.name || message._data?.notifyName || phone || name).trim().slice(0, 100) || 'WhatsApp customer';
    }
    if (this.client !== client) return;
    const input = { messageId: whatsappMessageId(message), customerKey: phone || message.from,
      chatId: message.from, name, phone, body: message.type === 'image' ? '[Payment screenshot]' : message.body };
    let proofResult;
    if (message.type === 'image') {
      if (!this.options.payments) return;
      const existing = await this.store.message(input.messageId); if (existing) return;
      // Current WhatsApp keys expose $1; downloadMedia still reads _serialized.
      if (!message.id._serialized && typeof message.id.$1 === 'string') message.id._serialized = message.id.$1;
      const media = await message.downloadMedia().catch(() => null);
      proofResult = media && media.data.length <= 7 * 1024 * 1024
        ? await this.options.payments.proof(input, Buffer.from(media.data, 'base64'), media.mimetype)
        : await this.store.saveReply(input, 'Screenshot could not be downloaded. Send a JPG or PNG under 5 MB.');
    }
    const result = proofResult || (this.options.assistant ? await this.options.assistant.process(input) : await this.store.process(input));
    if (result.paymentQr && !result.duplicate) {
      const invoice = await this.store.customerInvoice(input, result.paymentQr.invoiceId);
      if (!invoice || invoice.paymentStatus === 'paid') return;
      const png = await this.options.payments.qr(result.paymentQr.uri);
      const sent = await client.sendMessage(input.chatId, new this.library.MessageMedia('image/png', png.toString('base64'), 'pay-' + invoice.number + '.png'), { caption: result.reply, sendSeen: false });
      if (!whatsappMessageId(sent)) throw new Error('WhatsApp returned no payment QR confirmation.');
      this.status.lastReplyAt = new Date().toISOString(); this.status.error = null;
    }
    else if (result.copyInvoiceId) { if (!result.duplicate) await this.deliverCopy(input, result.copyInvoiceId); }
    else if (result.invoice) await this.deliver(result.invoice.id);
    else if (!result.duplicate) {
      try {
        const sent = await client.sendMessage(message.from, result.reply, { sendSeen: false });
        if (!whatsappMessageId(sent)) throw new Error('WhatsApp returned no outgoing message confirmation.');
        this.status.lastReplyAt = new Date().toISOString(); this.status.error = null;
      } catch (cause) { const error = new Error('WhatsApp reply failed: ' + String(cause?.message || cause)); error.botStage = 'reply'; throw error; }
    }
  }
  async start() {
    if (this.client) return;
    this.rememberConnection(true);
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
      this.enqueue(async () => { for (const id of await this.store.pending()) await this.deliver(id); });
    });
    client.on('auth_failure', () => { if (this.client === client) this.status = { state: 'error', qr: null, error: 'WhatsApp authentication failed. Stop the connection and link again.' }; });
    client.on('disconnected', () => { if (this.client === client) this.status = { state: 'disconnected', qr: null, error: 'WhatsApp disconnected. Stop and restart to reconnect.' }; });
    client.on('message', (message) => { this.enqueue(() => this.handleMessage(message, client)); });
    client.initialize().catch(() => { if (this.client === client) this.status = { state: 'error', qr: null, error: 'WhatsApp could not start. Check Chrome installation and the server setup guide.' }; });
  }
  async deliver(id, retry = false) {
    const invoice = await this.store.invoice(id);
    if (!invoice || invoice.isDemo || invoice.delivery === 'sent' || invoice.delivery === 'sending') return;
    if (!retry && invoice.delivery !== 'pending') return;
    if (this.status.state !== 'connected' || !this.client) throw new Error('Connect WhatsApp before sending an invoice.');
    // Generate before marking sending: rendering errors never become ambiguous delivery.
    const pdf = await invoicePdf(invoice, this.store.shopName);
    await this.store.delivery(id, 'sending');
    try {
      const media = new this.library.MessageMedia('application/pdf', pdf.toString('base64'), invoice.number + '.pdf');
      const sent = await this.client.sendMessage(invoice.destination, media, { caption: invoiceText(invoice, this.store.shopName) + (invoice.paymentStatus === 'paid' ? '' : checkoutText), sendMediaAsDocument: true, sendSeen: false });
      const sentId = whatsappMessageId(sent);
      if (!sentId) throw new Error('WhatsApp returned no outgoing invoice confirmation.');
      await this.store.delivery(id, 'sent', null, sentId);
      this.status.lastReplyAt = new Date().toISOString(); this.status.error = null;
    } catch (error) {
      await this.store.delivery(id, 'uncertain', 'Delivery could not be confirmed. Check the customer chat before resending. Khata was added only once.');
      this.reportError('invoice', error);
    }
  }
  async deliverCopy(input, id) {
    // Repeat the ownership check at the transport boundary, before sending a PDF.
    const invoice = await this.store.customerInvoice(input, id);
    if (!invoice || invoice.isDemo || input.isDemo) throw new Error('Invoice copy is not available for this account.');
    if (this.status.state !== 'connected' || !this.client) throw new Error('Connect WhatsApp before sending an invoice copy.');
    try {
      const pdf = await invoicePdf(invoice, this.store.shopName);
      const media = new this.library.MessageMedia('application/pdf', pdf.toString('base64'), invoice.number + '.pdf');
      const sent = await this.client.sendMessage(input.chatId, media, { caption: invoiceText(invoice, this.store.shopName) + (invoice.paymentStatus === 'paid' ? '' : checkoutText), sendMediaAsDocument: true, sendSeen: false });
      if (!whatsappMessageId(sent)) throw new Error('WhatsApp returned no invoice-copy confirmation.');
      this.status.lastReplyAt = new Date().toISOString(); this.status.error = null;
    } catch (cause) { const error = new Error('Invoice copy failed: ' + String(cause?.message || cause)); error.botStage = 'reply'; throw error; }
  }
  async stop({ preserveEnabled = false } = {}) {
    if (!preserveEnabled) this.rememberConnection(false);
    const client = this.client; this.client = null; this.connectedAt = null;
    if (client) await client.destroy().catch(() => undefined);
    this.status = { state: 'idle', qr: null, error: null };
  }
}
