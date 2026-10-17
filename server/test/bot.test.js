import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { parseOrder } from '../src/orders.js';
import { WhatsAppBot } from '../src/whatsapp.js';
import { createApi } from '../src/api.js';
import { invoicePdf } from '../src/invoice-pdf.js';

const catalogue = JSON.parse(readFileSync(new URL('../catalogue.json', import.meta.url), 'utf8'));
const incoming = (patch = {}) => ({ messageId: 'message-1', customerKey: '919900000001', chatId: '919900000001@c.us', name: 'Test Customer', phone: '919900000001', body: '2 kg rice, 1 kg sugar', ...patch });
function memory(t) { const store = new Store(':memory:', catalogue, 'Test Shop'); t.after(() => store.close()); return store; }

test('prices complete English/Hinglish/Hindi orders and converts grams exactly', () => {
  assert.equal(parseOrder('2 kg rice aur 1 kg sugar', catalogue).totalPaise, 16500);
  assert.equal(parseOrder('rice 2kg\nsugar 1kg', catalogue).totalPaise, 16500);
  assert.equal(parseOrder('५०० ग्राम चावल और १ किलो चीनी', catalogue).totalPaise, 7500);
  assert.equal(parseOrder('500 ml oil', catalogue).totalPaise, 7500);
  assert.equal(parseOrder('2 biscuits', catalogue).totalPaise, 2000);
});
test('unknown items, mismatched units, negative quantities and ambiguous text fail the entire order', () => {
  for (const body of ['2 kg rice, 1 kg unknown', '1 litre rice', '-2 kg rice', '0 kg rice', 'get some rice', '1.5 packet biscuits', '0.1 g rice', '2 kg rice, paid 500']) assert.ok(parseOrder(body, catalogue).error, body);
});
test('one order atomically creates one invoice and one debit; redelivery changes nothing', (t) => {
  const store = memory(t);
  const first = store.process(incoming());
  assert.equal(first.invoice.totalPaise, 16500);
  assert.equal(store.balance(first.invoice.customerId), 16500);
  const repeated = store.process(incoming());
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.invoice.id, first.invoice.id);
  assert.equal(store.snapshot().invoices.length, 1);
  assert.equal(store.snapshot().records.length, 3);
  assert.equal(store.snapshot().records.filter((r) => r.kind === 'receipt').length, 0);
  assert.equal(store.process(incoming({ messageId: 'message-2' })).invoice.balanceAfterPaise, 33000);
});
test('clarification and menu messages do not create customer debt or partial invoices', (t) => {
  const store = memory(t);
  assert.equal(store.process(incoming({ body: '2 kg rice, 1 unknown' })).invoice, null);
  assert.equal(store.process(incoming({ messageId: 'menu', body: 'MENU' })).invoice, null);
  assert.equal(store.snapshot().invoices.length, 0);
  assert.equal(store.snapshot().parties.length, 0);
});
test('demo and real identities are separate; equal display names never merge different contacts', (t) => {
  const store = memory(t);
  const live = store.process(incoming()).invoice;
  const demo = store.process(incoming({ isDemo: true })).invoice;
  const other = store.process(incoming({ messageId: 'other', customerKey: 'another@lid' })).invoice;
  assert.notEqual(live.customerId, demo.customerId);
  assert.notEqual(live.customerId, other.customerId);
  assert.deepEqual(store.pending(), [live.id, other.id]);
  assert.equal(demo.delivery, 'demo');
});
test('price changes affect future orders, while existing invoice prices stay frozen', (t) => {
  const store = memory(t);
  const original = store.process(incoming()).invoice;
  store.setPrice('rice', 7000);
  assert.equal(store.process(incoming({ messageId: 'second' })).invoice.totalPaise, 18500);
  assert.equal(store.invoice(original.id).totalPaise, 16500);
  assert.throws(() => store.setPrice('rice', -100));
});
test('invoices and ledger survive restart and an interrupted send requires delivery review', () => {
  const path = join(tmpdir(), 'dukanpe-bot-test-' + randomUUID() + '.sqlite');
  let store;
  try {
    store = new Store(path, catalogue, 'Test Shop');
    const invoice = store.process(incoming()).invoice;
    store.delivery(invoice.id, 'sending'); store.close(); store = new Store(path, catalogue, 'Test Shop');
    assert.equal(store.invoice(invoice.id).delivery, 'uncertain');
    assert.equal(store.balance(invoice.customerId), 16500);
    assert.equal(store.process(incoming()).duplicate, true);
  } finally { store?.close(); for (const suffix of ['', '-wal', '-shm']) try { unlinkSync(path + suffix); } catch { /* SQLite may remove journals itself. */ } }
});
test('PDF is generated from frozen invoice details', async (t) => {
  const store = memory(t);
  const pdf = await invoicePdf(store.process(incoming()).invoice, 'Test Shop');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1000);
});
test('delivery sends a PDF once; failures never create another khata debit', async (t) => {
  const store = memory(t);
  const invoice = store.process(incoming()).invoice;
  const bot = new WhatsAppBot(store, '.');
  let sent = 0;
  bot.status.state = 'connected'; bot.library = { MessageMedia: class { constructor(type, body) { this.type = type; this.body = body; } } };
  bot.client = { sendMessage: async (_chat, media) => { sent++; assert.equal(media.type, 'application/pdf'); return { id: { _serialized: 'sent-id' } }; } };
  await bot.deliver(invoice.id); await bot.deliver(invoice.id); assert.equal(sent, 1);
  assert.equal(store.invoice(invoice.id).delivery, 'sent');
  const next = store.process(incoming({ messageId: 'second' })).invoice;
  bot.client.sendMessage = async () => { throw new Error('Disconnected after send'); };
  await bot.deliver(next.id); assert.equal(store.invoice(next.id).delivery, 'uncertain');
  await bot.deliver(next.id); assert.equal(store.balance(invoice.customerId), 33000);
});
test('API requires pairing, refuses unknown web origins, and signs short-lived PDF links', async (t) => {
  const store = memory(t);
  const bot = new WhatsAppBot(store, '.');
  const token = 'test-pairing-secret-at-least-24-characters';
  const server = createApi({ store, bot, token }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/snapshot')).status, 401);
  assert.equal((await fetch(base + '/api/snapshot', { headers: { ...headers, Origin: 'https://unknown.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/snapshot', { headers: { ...headers, Origin: 'http://localhost:8081' } })).status, 200);
  const response = await fetch(base + '/api/demo/order', { method: 'POST', headers, body: JSON.stringify(incoming()) });
  const result = await response.json(); assert.equal(result.invoice.totalPaise, 16500);
  const link = await (await fetch(base + '/api/invoices/' + result.invoice.id + '/pdf-link', { headers })).json();
  assert.ok(!link.path.includes(token));
  const pdf = await fetch(base + link.path); assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /pdf/);
  assert.equal((await fetch(base + link.path.replace(/signature=[^&]+/, 'signature=invalid'))).status, 401);
  assert.equal((await fetch(base + '/api/invoices/' + result.invoice.id + '/resend', { method: 'POST', headers })).status, 400);
});
