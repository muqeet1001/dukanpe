import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
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
const chatMessage = (patch = {}) => ({ id: { _serialized: randomUUID() }, from: '919900000001@lid', fromMe: false, broadcast: false,
  type: 'chat', timestamp: Math.floor(Date.now() / 1000), body: 'HI', getContact: async () => { throw new Error('Contact API unavailable'); }, ...patch });

test('an enabled connection survives server shutdown while a manual stop disables automatic reconnection', async (t) => {
  const store = memory(t); const directory = mkdtempSync(join(tmpdir(), 'dukanpe-connection-test-'));
  t.after(() => { unlinkSync(join(directory, 'whatsapp-enabled.json')); rmdirSync(directory); });
  const bot = new WhatsAppBot(store, directory); assert.equal(bot.shouldResume, false);
  bot.rememberConnection(true); await bot.stop({ preserveEnabled: true });
  const restarted = new WhatsAppBot(store, directory); assert.equal(restarted.shouldResume, true);
  await restarted.stop(); assert.equal(restarted.shouldResume, false);
});

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

test('greetings, numbered menu and order help stay nonfinancial; the following order creates one invoice', (t) => {
  const store = memory(t);
  for (const body of ['HI', ' hi! ', 'Hiii', 'Hello.', 'HEY', 'Namaste', 'नमस्ते', '/start']) {
    const result = store.process(incoming({ messageId: body, body }));
    assert.match(result.reply, /Welcome to \*Test Shop\*/);
    assert.match(result.reply, /\*1\*.*products/);
    assert.equal(result.invoice, null);
  }
  store.setPrice('rice', 7000);
  assert.match(store.process(incoming({ messageId: 'choice-1', body: '1' })).reply, /Rice: INR 70.00/);
  assert.match(store.process(incoming({ messageId: 'choice-2', body: '2' })).reply, /Ready to order/);
  assert.match(store.process(incoming({ messageId: 'order-help', body: 'ORDER' })).reply, /has not placed an order/);
  assert.equal(store.snapshot().invoices.length, 0);
  assert.equal(store.snapshot().parties.length, 0);
  const order = incoming({ messageId: 'actual-order' });
  assert.equal(store.process(order).invoice.totalPaise, 18500);
  assert.equal(store.process(order).duplicate, true);
  assert.equal(store.snapshot().invoices.length, 1);
});

test('incoming HI replies without contact APIs and duplicate events do not send a second greeting', async (t) => {
  const store = memory(t); const bot = new WhatsAppBot(store, '.'); const replies = [];
  bot.connectedAt = Date.now(); bot.status.state = 'connected';
  bot.client = { sendMessage: async (chat, text, options) => {
    replies.push(text); assert.equal(chat, '919900000001@lid'); assert.equal(options.sendSeen, false);
    return { id: { _serialized: 'reply-' + replies.length } };
  }, getContactLidAndPhone: async () => { assert.fail('HI must not resolve a phone number'); } };
  const message = chatMessage({ getContact: () => assert.fail('HI must not load a contact') });
  await bot.handleMessage(message); await bot.handleMessage(message);
  assert.equal(replies.length, 1); assert.match(replies[0], /Namaste!/);
  await bot.handleMessage(chatMessage()); assert.equal(replies.length, 2);
  assert.ok(bot.status.lastIncomingAt); assert.ok(bot.status.lastReplyAt);
  assert.equal(store.snapshot().invoices.length, 0);
});

test('a failed reply is visible, does not block the queue, and a fresh HI recovers', async (t) => {
  const store = memory(t); const errors = []; const bot = new WhatsAppBot(store, '.', { onError: (stage) => errors.push(stage) });
  bot.connectedAt = Date.now(); bot.status.state = 'connected';
  bot.client = { sendMessage: async () => { throw new Error('Connection unavailable'); } };
  await bot.enqueue(() => bot.handleMessage(chatMessage()));
  assert.deepEqual(errors, ['reply']); assert.match(bot.status.error, /reply could not be confirmed/);
  assert.equal(bot.status.lastReplyAt, undefined);
  bot.client.sendMessage = async () => ({ id: { _serialized: 'confirmed-reply' } });
  await bot.enqueue(() => bot.handleMessage(chatMessage()));
  assert.equal(bot.status.error, null); assert.ok(bot.status.lastReplyAt);
  assert.equal(store.snapshot().parties.length, 0);
});

test('WhatsApp returning no outgoing message is reported rather than shown as a successful reply', async (t) => {
  const store = memory(t); const bot = new WhatsAppBot(store, '.', { onError: () => {} });
  bot.connectedAt = Date.now(); bot.status.state = 'connected'; bot.client = { sendMessage: async () => undefined };
  await bot.enqueue(() => bot.handleMessage(chatMessage()));
  assert.match(bot.status.error, /reply could not be confirmed/); assert.equal(bot.status.lastReplyAt, undefined);
});

test('a null LID phone lookup still accepts an order and sends one PDF against the chat identity', async (t) => {
  const store = memory(t); const bot = new WhatsAppBot(store, '.'); let sends = 0;
  bot.connectedAt = Date.now(); bot.status.state = 'connected';
  bot.library = { MessageMedia: class {} };
  bot.client = { getContactLidAndPhone: async () => null, sendMessage: async () => { sends++; return { id: { _serialized: 'pdf-reply' } }; } };
  const message = chatMessage({ body: '2 kg rice, 1 kg sugar' });
  await bot.handleMessage(message); await bot.handleMessage(message);
  assert.equal(sends, 1); const [invoice] = store.snapshot().invoices;
  assert.equal(invoice.delivery, 'sent'); assert.equal(invoice.totalPaise, 16500);
  assert.equal(store.balance(invoice.customerId), 16500);
});

test('complete customer WhatsApp conversation creates a named khata account without any app order entry', async (t) => {
  const store = memory(t); const bot = new WhatsAppBot(store, '.'); const replies = [];
  bot.connectedAt = Date.now(); bot.status.state = 'connected'; bot.library = { MessageMedia: class {} };
  bot.client = { getContactLidAndPhone: async () => [{ pn: '919900000001@c.us' }], sendMessage: async (_chat, content) => {
    replies.push(content); return { id: { _serialized: 'reply-' + replies.length } };
  } };
  for (const body of ['HI', '1', '2']) await bot.handleMessage(chatMessage({ body }));
  assert.match(replies[0], /Welcome/); assert.match(replies[1], /Rice: INR 60/); assert.match(replies[2], /Ready to order/);
  assert.equal(store.snapshot().invoices.length, 0);
  const order = chatMessage({ body: '2 kg rice, 1 kg sugar', getContact: async () => ({ pushname: 'Roy' }) });
  await bot.handleMessage(order); await bot.handleMessage(order);
  const snapshot = store.snapshot();
  assert.equal(replies.length, 4); assert.equal(snapshot.parties[0].name, 'Roy');
  assert.equal(snapshot.invoices[0].customerName, 'Roy'); assert.equal(snapshot.invoices[0].delivery, 'sent');
  assert.equal(snapshot.records.filter((record) => record.kind === 'sale').length, 1);
  assert.equal(store.balance(snapshot.parties[0].id), 16500);
});

test('outgoing, self, group, broadcast, media and old-history messages cannot trigger the bot', async (t) => {
  const store = memory(t); const bot = new WhatsAppBot(store, '.'); bot.connectedAt = Date.now();
  bot.client = { sendMessage: () => assert.fail('Ignored messages cannot get a reply') };
  for (const patch of [{ fromMe: true }, { from: 'group@g.us' }, { from: 'status@broadcast' }, { broadcast: true },
    { type: 'image' }, { timestamp: Math.floor(Date.now() / 1000) - 120 }, { timestamp: undefined }]) await bot.handleMessage(chatMessage(patch));
  assert.equal(bot.status.lastIncomingAt, undefined); assert.equal(store.snapshot().invoices.length, 0);
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
  const bot = new WhatsAppBot(store, '.', { onError: () => {} });
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
