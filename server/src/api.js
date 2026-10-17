import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { invoicePdf } from './invoice-pdf.js';
import { setupPairing } from './setup-pairing.js';

export const equalSecret = (first, second) => typeof first === 'string' && Buffer.byteLength(first) === Buffer.byteLength(second) && timingSafeEqual(Buffer.from(first), Buffer.from(second));
export function createApi({ store, bot, token, assistant, payments, deviceAccess, directLink, pairingBaseUrl, extraOrigins = [] }) {
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
  const pairing = setupPairing({ token, baseUrl: pairingBaseUrl || process.env.BOT_LAN_URL });
  app.post('/pairing/exchange', (req, res) => pairing.exchange(req, res));
  const directAttempts = new Map();
  app.post('/connect/whatsapp', async (req, res) => {
    if (!directLink) return res.status(503).json({ error: 'Restart the Dukanpe service to enable WhatsApp linking.' });
    const now = Date.now(); const address = req.socket.remoteAddress;
    for (const [key, attempt] of directAttempts) if (now - attempt.since >= 60000) directAttempts.delete(key);
    const attempt = directAttempts.get(address) || { since: now, count: 0 }; attempt.count++; directAttempts.set(address, attempt);
    if (attempt.count > 12) return res.status(429).json({ error: 'Please wait a minute before opening another WhatsApp QR.' });
    res.json(await directLink.start(req.body?.linkToken, req.body?.replace === true));
  });
  app.post('/connect/whatsapp/status', async (req, res) => {
    if (!directLink) return res.status(503).json({ error: 'WhatsApp linking is unavailable.' });
    res.json(await directLink.status(req.body?.linkToken));
  });
  const signPdf = (id, expires) => createHmac('sha256', token).update(`invoice-pdf:${id}:${expires}`).digest('hex');
  const signProof = (id, proofId, expires) => createHmac('sha256', token).update(`payment-proof:${id}:${proofId}:${expires}`).digest('hex');
  app.get('/download/payment/:id/:proofId', async (req, res) => {
    const { expires, signature } = req.query;
    if (!payments || typeof expires !== 'string' || !/^\d{13}$/.test(expires) || Number(expires) < Date.now()
      || Number(expires) > Date.now() + 5 * 60000 || !equalSecret(signature, signProof(req.params.id, req.params.proofId, expires))) return res.status(401).json({ error: 'This screenshot link has expired.' });
    const image = await payments.image(req.params.id, req.params.proofId);
    if (!image) return res.status(404).json({ error: 'Screenshot not found.' });
    res.type(image.mime).set('Content-Disposition', 'inline; filename="payment-proof"').send(image.buffer);
  });
  // Browser-openable, short-lived PDF links do not expose the API pairing credential.
  app.get('/download/invoice/:id', async (req, res) => {
    const { expires, signature } = req.query;
    if (typeof expires !== 'string' || !/^\d{13}$/.test(expires) || Number(expires) < Date.now()
      || Number(expires) > Date.now() + 5 * 60000 || !equalSecret(signature, signPdf(req.params.id, expires))) return res.status(401).json({ error: 'This invoice link has expired.' });
    const invoice = await store.invoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    res.type('pdf').set('Content-Disposition', `inline; filename="${invoice.number}.pdf"`).send(await invoicePdf(invoice, store.shopName));
  });
  app.use('/api', (req, res, next) => {
    const header = req.get('authorization') || '';
    if (!header.startsWith('Bearer ') || !(equalSecret(header.slice(7), token) || deviceAccess?.accepts(header.slice(7), bot.merchantAccount?.id))) return res.status(401).json({ error: 'Shop access expired. Reconnect WhatsApp to authorise this device.' });
    next();
  });
  app.get('/api/snapshot', async (_req, res) => res.json({ ...await store.snapshot({ liveOnly: true }), status: bot.status,
    merchant: { upiId: payments?.upiId || '', name: store.shopName } }));
  app.post('/api/pairing/qr', async (req, res) => res.json(await pairing.issue(req)));
  app.get('/api/payments/:id/proof-link', async (req, res) => {
    const payment = await store.payment(req.params.id);
    if (!payment || !payments) return res.status(404).json({ error: 'Screenshot not found.' });
    const expires = String(Date.now() + 5 * 60000);
    res.json({ path: `/download/payment/${encodeURIComponent(req.params.id)}/${payment.proofId}?expires=${expires}&signature=${signProof(req.params.id, payment.proofId, expires)}` });
  });
  app.post('/api/payments/:id/review', async (req, res) => {
    const { proofId, decision, receivedInAccount } = req.body || {};
    if (typeof proofId !== 'string' || !/^[a-f0-9]{64}$/.test(proofId) || !['confirmed', 'rejected'].includes(decision)
      || (decision === 'confirmed' && receivedInAccount !== true)) return res.status(400).json({ error: 'Review the screenshot and confirm receipt in your own account first.' });
    try { res.json({ payment: await store.reviewPayment(req.params.id, proofId, decision) }); }
    catch (error) { if (/proof changed|awaiting review|reference already used/.test(error.message)) return res.status(409).json({ error: error.message }); throw error; }
  });
  app.post('/api/whatsapp/start', async (_req, res) => { await bot.start(); res.status(202).json({ status: bot.status }); });
  app.post('/api/whatsapp/stop', async (_req, res) => { await bot.stop(); res.json({ status: bot.status }); });
  app.put('/api/catalogue/:id', async (req, res) => { await store.setPrice(req.params.id, req.body?.pricePaise); res.json({ catalogue: await store.catalogue() }); });
  app.post('/api/demo/order', async (req, res) => {
    const { messageId, name = 'Demo Customer', phone = '919999900001', body } = req.body ?? {};
    if (typeof phone !== 'string' || !/^\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'Use a test phone number with country code, digits only.' });
    const input = { messageId, customerKey: 'demo:' + phone, phone, name, body, isDemo: true };
    const result = assistant ? await assistant.process(input) : await store.process(input);
    res.json(result);
  });
  app.get('/api/invoices/:id/pdf-link', async (req, res) => {
    if (!await store.invoice(req.params.id)) return res.status(404).json({ error: 'Invoice not found.' });
    const expires = String(Date.now() + 5 * 60000);
    res.json({ path: `/download/invoice/${encodeURIComponent(req.params.id)}?expires=${expires}&signature=${signPdf(req.params.id, expires)}` });
  });
  app.post('/api/invoices/:id/resend', async (req, res) => {
    const invoice = await store.invoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    if (invoice.isDemo) return res.status(400).json({ error: 'Simulated invoices cannot be sent to WhatsApp.' });
    if (bot.status.state !== 'connected') return res.status(409).json({ error: 'Connect WhatsApp before resending.' });
    await bot.enqueue(() => bot.deliver(invoice.id, true));
    res.json({ invoice: await store.invoice(invoice.id) });
  });
  app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, _req, res, _next) => {
    const message = error instanceof Error ? error.message : 'Request failed.';
    if ([401, 409].includes(error.status)) return res.status(error.status).json({ error: message });
    const validation = /Invalid order|valid price|Product not found|JSON|too large/i.test(message);
    res.status(validation ? 400 : 500).json({ error: validation ? message : 'The bot could not complete this request. Check the server.' });
  });
  return app;
}
