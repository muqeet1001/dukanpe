import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { WhatsAppAssistant } from '../src/assistant.js';
import { PaymentService, inspectProof, upiUri, chatKey } from '../src/payments.js';
import { WhatsAppBot } from '../src/whatsapp.js';
import { createApi } from '../src/api.js';

const catalogue = JSON.parse(readFileSync(new URL('../catalogue.json', import.meta.url), 'utf8'));
const message = (body, patch = {}) => ({ messageId: randomUUID(), customerKey: 'customer-one', chatId: 'customer-one@lid', name: 'Customer', phone: '', body, ...patch });
// Minimal image signature for service tests; OCR is injected. Real OCR gets a separate smoke test.
const image = (suffix = 'one') => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('test-image-bytes-' + suffix)]);
function fixture(t, options = {}) {
  const store = new Store(':memory:', catalogue, 'Test Shop');
  const directory = mkdtempSync(join(tmpdir(), 'dukanpe-payments-'));
  const payments = new PaymentService(store, directory, { upiId: 'merchant@upi', ocr: async () => 'Payment successful INR 120.00 merchant@upi UTR: 123456789012', ...options });
  const agent = new WhatsAppAssistant(store, { interpret: async () => null }, payments);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, payments, agent };
}

test('UPI QR carries the exact paise amount, merchant and invoice, with no payment side effect', async (t) => {
  const { store, payments } = fixture(t);
  const invoice = store.process(message('2 kg rice')).invoice;
  const uri = new URL(upiUri({ ...invoice, totalPaise: 12001 }, 'merchant@upi', 'Shop & Sons'));
  assert.equal(uri.protocol, 'upi:'); assert.equal(uri.searchParams.get('pa'), 'merchant@upi');
  assert.equal(uri.searchParams.get('pn'), 'Shop & Sons'); assert.equal(uri.searchParams.get('am'), '120.01');
  assert.equal(uri.searchParams.get('tr'), invoice.number); assert.equal(uri.searchParams.get('cu'), 'INR');
  const png = await payments.qr(uri.toString()); assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.throws(() => upiUri(invoice, '', 'Shop'), /not configured/); assert.equal(store.balance(invoice.customerId), 12000);
});

test('confirmed orders offer checkout; numbered Pay now and Khata work without another debit', async (t) => {
  const { store, agent } = fixture(t);
  await agent.previewOrder(message('rice'), '2 kg rice');
  const confirmed = await agent.process(message('CONFIRM')); const id = confirmed.invoice.id;
  assert.equal(store.conversation(chatKey(message(''))).kind, 'checkout');
  const qr = await agent.process(message('1')); assert.equal(qr.paymentQr.invoiceId, id); assert.match(qr.reply, /120.00/);
  assert.equal(store.conversation(chatKey(message(''))).kind, 'payment');
  assert.match((await agent.process(message('2'))).reply, /stays in your khata/);
  assert.equal(store.balance(confirmed.invoice.customerId), 12000); assert.equal(store.snapshot().invoices.length, 1);
  assert.equal((await agent.process(message('PAY NOW'))).paymentQr.invoiceId, id);
  assert.equal((await agent.process(message('PAY NOW', { customerKey: 'stranger', chatId: 'stranger@lid' }))).paymentQr, undefined);
});

test('matching screenshot waits for review; merchant confirmation settles exactly once across snapshots', async (t) => {
  const { store, payments, agent } = fixture(t);
  const invoice = (await agent.process(message('2 kg rice'))).invoice;
  await agent.process(message('1'));
  const proofMessage = message('[Payment screenshot]');
  const result = await payments.proof(proofMessage, image(), 'image/png'); assert.match(result.reply, /Awaiting merchant verification/);
  assert.equal(store.balance(invoice.customerId), 12000); assert.equal(store.invoice(invoice.id).paymentStatus, 'unpaid');
  const proof = store.payment(invoice.id); assert.equal(proof.status, 'review'); assert.equal(proof.checks.amountMatched, true);
  assert.equal(store.snapshot().records.find((r) => r.kind === 'receipt').status, 'review');
  assert.equal((await payments.proof(proofMessage, image(), 'image/png')).duplicate, true);
  assert.match((await agent.process(message('PAY NOW'))).reply, /Do not pay again/);
  store.reviewPayment(invoice.id, proof.proofId, 'confirmed'); store.reviewPayment(invoice.id, proof.proofId, 'confirmed');
  assert.equal(store.balance(invoice.customerId), 0); assert.equal(store.invoice(invoice.id).paymentStatus, 'paid');
  const receipts = store.snapshot().records.filter((r) => r.kind === 'receipt'); assert.equal(receipts.length, 1); assert.equal(receipts[0].status, 'confirmed');
  assert.match((await agent.process(message('ORDER STATUS'))).reply, /Payment: PAID/);
  assert.equal((await agent.process(message('PAY NOW'))).paymentQr, undefined);
});

test('proof scope, invalid image, stale review and rejected/reused screenshots cannot settle debt', async (t) => {
  const { store, payments, agent } = fixture(t);
  const first = (await agent.process(message('2 kg rice'))).invoice;
  assert.match((await payments.proof(message('[Payment screenshot]', { customerKey: 'stranger', chatId: 'other@lid' }), image(), 'image/png')).reply, /PAY NOW/);
  await agent.process(message('1'));
  assert.match((await payments.proof(message('[Payment screenshot]'), Buffer.from('fake'), 'image/png')).reply, /PNG or JPG/);
  await payments.proof(message('[Payment screenshot]'), image(), 'image/png');
  const proof = store.payment(first.id);
  assert.throws(() => store.reviewPayment(first.id, 'f'.repeat(64), 'confirmed'), /proof changed/);
  store.reviewPayment(first.id, proof.proofId, 'rejected');
  assert.equal(store.snapshot().records.filter((r) => r.kind === 'receipt').length, 0);
  await agent.process(message('PAY NOW'));
  assert.match((await payments.proof(message('[Payment screenshot]'), image(), 'image/png')).reply, /rejected/);
  const second = (await agent.process(message('1 kg sugar'))).invoice; await agent.process(message('1'));
  assert.match((await payments.proof(message('[Payment screenshot]'), image(), 'image/png')).reply, /another invoice/);
  assert.equal(store.payment(second.id), null); assert.equal(store.balance(first.customerId), 16500);
});

test('unreadable or mismatched screenshots stay reviewable; repeated UTR cannot settle two invoices', async (t) => {
  const { store, payments, agent } = fixture(t, { ocr: async () => { throw new Error('Unreadable'); } });
  const invoice = (await agent.process(message('2 kg rice'))).invoice; await agent.process(message('1'));
  await payments.proof(message('[Payment screenshot]'), image(), 'image/png');
  let proof = store.payment(invoice.id); assert.ok(proof.checks.warnings.some((w) => /could not be read/.test(w)));
  assert.equal(proof.status, 'review'); assert.equal(store.balance(invoice.customerId), 12000);
  payments.ocr = async () => 'Paid INR 120.00 merchant@upi UTR 123456789012';
  await payments.proof(message('[Payment screenshot]'), image('updated'), 'image/png'); proof = store.payment(invoice.id);
  store.reviewPayment(invoice.id, proof.proofId, 'confirmed');
  const other = (await agent.process(message('2 kg rice'))).invoice; await agent.process(message('1'));
  await payments.proof(message('[Payment screenshot]'), image('different-image-same-utr'), 'image/png');
  assert.throws(() => store.reviewPayment(other.id, store.payment(other.id).proofId, 'confirmed'), /reference already used/);
  assert.equal(store.balance(invoice.customerId), 12000);
  const checks = inspectProof('Payment pending INR 100.00 stranger@upi', invoice, 'merchant@upi');
  assert.equal(checks.amountMatched, false); assert.equal(checks.payeeMatched, false); assert.equal(checks.successful, false);
});

test('real WhatsApp transport sends QR and accepts image proof without affecting receipt status', async (t) => {
  const { store, payments, agent } = fixture(t); const sent = [];
  // Transport resolves this sender to its JID when no phone mapping is available.
  const sender = 'customer-one@lid';
  await agent.process(message('2 kg rice', { customerKey: sender }));
  const bot = new WhatsAppBot(store, '.', { assistant: agent, payments }); bot.connectedAt = Date.now(); bot.status.state = 'connected';
  bot.library = { MessageMedia: class { constructor(mime, data) { this.mimetype = mime; this.data = data; } } };
  bot.client = { getContactLidAndPhone: async () => [], sendMessage: async (to, media, options) => { sent.push({ to, media, options }); return { id: { $1: 'outgoing-' + sent.length } }; } };
  const incoming = (body, patch = {}) => ({ id: { $1: randomUUID() }, from: sender, body, type: 'chat', timestamp: Math.floor(Date.now() / 1000), getContact: async () => ({ pushname: 'Customer' }), ...patch });
  await bot.handleMessage(incoming('1')); assert.equal(sent[0].media.mimetype, 'image/png'); assert.match(sent[0].options.caption, /merchant@upi/);
  await bot.handleMessage(incoming('', { type: 'image', downloadMedia: async () => ({ data: image().toString('base64'), mimetype: 'image/png' }) }));
  assert.match(sent[1].media, /Awaiting merchant verification/); assert.equal(store.snapshot().payments[0].status, 'review');
});

test('merchant API protects screenshots and requires an explicit receipt acknowledgement; live snapshot excludes samples', async (t) => {
  const { store, payments, agent } = fixture(t);
  store.process(message('1 kg rice', { isDemo: true }));
  const invoice = (await agent.process(message('2 kg rice'))).invoice; await agent.process(message('1'));
  await payments.proof(message('[Payment screenshot]'), image(), 'image/png'); const proof = store.payment(invoice.id);
  const token = 'a-private-test-credential-with-enough-length';
  const bot = { status: { state: 'connected', qr: null, error: null } };
  const server = createApi({ store, payments, bot, token }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve)); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port; const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/payments/' + invoice.id + '/proof-link')).status, 401);
  const link = await (await fetch(base + '/api/payments/' + invoice.id + '/proof-link', { headers })).json();
  assert.equal((await fetch(base + link.path)).status, 200); assert.equal((await fetch(base + link.path.replace(/signature=.+/, 'signature=invalid'))).status, 401);
  const body = { proofId: proof.proofId, decision: 'confirmed' };
  assert.equal((await fetch(base + '/api/payments/' + invoice.id + '/review', { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
  assert.equal((await fetch(base + '/api/payments/' + invoice.id + '/review', { method: 'POST', headers, body: JSON.stringify({ ...body, receivedInAccount: true }) })).status, 200);
  const snapshot = await (await fetch(base + '/api/snapshot', { headers })).json();
  assert.equal(snapshot.invoices.length, 1); assert.equal(snapshot.invoices[0].paymentStatus, 'paid'); assert.equal(snapshot.parties.length, 1);
});
