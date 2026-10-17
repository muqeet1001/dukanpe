import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { invoicePdf } from './invoice-pdf.js';

export const equalSecret = (first, second) => typeof first === 'string' && Buffer.byteLength(first) === Buffer.byteLength(second) && timingSafeEqual(Buffer.from(first), Buffer.from(second));
export function createApi({ store, bot, token, extraOrigins = [] }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff');
    const origin = req.get('origin');
    if (origin) {
      let allowed = extraOrigins.includes(origin);
      try {
        const url = new URL(origin);
        const host = new URL('http://' + req.get('host')).hostname;
        allowed ||= url.protocol === 'http:' && ['localhost', '127.0.0.1', host].includes(url.hostname) && ['8081', '8082'].includes(url.port);
      } catch { /* Invalid origins are refused. */ }
      if (!allowed) return res.status(403).json({ error: 'This web origin is not allowed.' });
      res.set('Access-Control-Allow-Origin', origin); res.vary('Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'dukanpe-whatsapp-bot' }));
  const signPdf = (id, expires) => createHmac('sha256', token).update(`invoice-pdf:${id}:${expires}`).digest('hex');
  // Browser-openable, short-lived PDF links do not expose the API pairing credential.
  app.get('/download/invoice/:id', async (req, res) => {
    const { expires, signature } = req.query;
    if (typeof expires !== 'string' || !/^\d{13}$/.test(expires) || Number(expires) < Date.now()
      || Number(expires) > Date.now() + 5 * 60000 || !equalSecret(signature, signPdf(req.params.id, expires))) return res.status(401).json({ error: 'This invoice link has expired.' });
    const invoice = store.invoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    res.type('pdf').set('Content-Disposition', `inline; filename="${invoice.number}.pdf"`).send(await invoicePdf(invoice, store.shopName));
  });
  app.use('/api', (req, res, next) => {
    const header = req.get('authorization') || '';
    if (!header.startsWith('Bearer ') || !equalSecret(header.slice(7), token)) return res.status(401).json({ error: 'Pairing code is incorrect. Check the server pairing-code file.' });
    next();
  });
  app.get('/api/snapshot', (_req, res) => res.json({ ...store.snapshot(), status: bot.status }));
  app.post('/api/whatsapp/start', async (_req, res) => { await bot.start(); res.status(202).json({ status: bot.status }); });
  app.post('/api/whatsapp/stop', async (_req, res) => { await bot.stop(); res.json({ status: bot.status }); });
  app.put('/api/catalogue/:id', (req, res) => { store.setPrice(req.params.id, req.body?.pricePaise); res.json({ catalogue: store.catalogue() }); });
  app.post('/api/demo/order', (req, res) => {
    const { messageId, name = 'Demo Customer', phone = '919999900001', body } = req.body ?? {};
    if (typeof phone !== 'string' || !/^\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'Use a test phone number with country code, digits only.' });
    const result = store.process({ messageId, customerKey: 'demo:' + phone, phone, name, body, isDemo: true });
    res.json(result);
  });
  app.get('/api/invoices/:id/pdf-link', (req, res) => {
    if (!store.invoice(req.params.id)) return res.status(404).json({ error: 'Invoice not found.' });
    const expires = String(Date.now() + 5 * 60000);
    res.json({ path: `/download/invoice/${encodeURIComponent(req.params.id)}?expires=${expires}&signature=${signPdf(req.params.id, expires)}` });
  });
  app.post('/api/invoices/:id/resend', async (req, res) => {
    const invoice = store.invoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    if (invoice.isDemo) return res.status(400).json({ error: 'Simulated invoices cannot be sent to WhatsApp.' });
    if (bot.status.state !== 'connected') return res.status(409).json({ error: 'Connect WhatsApp before resending.' });
    await bot.enqueue(() => bot.deliver(invoice.id, true));
    res.json({ invoice: store.invoice(invoice.id) });
  });
  app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, _req, res, _next) => {
    const message = error instanceof Error ? error.message : 'Request failed.';
    const validation = /Invalid order|valid price|Product not found|JSON|too large/i.test(message);
    res.status(validation ? 400 : 500).json({ error: validation ? message : 'The bot could not complete this request. Check the server.' });
  });
  return app;
}
