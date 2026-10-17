import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { WhatsAppAssistant } from '../src/assistant.js';
import { WhatsAppBot, whatsappMessageId } from '../src/whatsapp.js';

const catalogue = JSON.parse(readFileSync(new URL('../catalogue.json', import.meta.url), 'utf8'));
const input = (body, patch = {}) => ({ messageId: randomUUID(), customerKey: '919900000001', chatId: '919900000001@c.us', name: 'Roy', phone: '919900000001', body, ...patch });
const other = (body) => input(body, { customerKey: '919900000002', chatId: '919900000002@c.us', phone: '919900000002', name: 'Roy' });
function fixture(t) {
  const store = new Store(':memory:', catalogue, 'Test Shop'); t.after(() => store.close());
  const ai = { interpret: async () => assert.fail('This DB query should not need AI') };
  return { store, ai, agent: new WhatsAppAssistant(store, ai) };
}

test('balance and history come from the authenticated customer records and stay separate from equal display names', async (t) => {
  const { store, agent } = fixture(t);
  const own = store.process(input('2 kg rice, 1 kg sugar')).invoice;
  const foreign = store.process(other('1 litre oil')).invoice;
  const balance = await agent.process(input('What do I owe?')); assert.match(balance.reply, /INR 165.00/); assert.doesNotMatch(balance.reply, /150.00/);
  store.process(input('1 kg rice'));
  assert.match((await agent.process(input('BALANCE'))).reply, /INR 225.00/);
  const history = await agent.process(input('MY ORDERS')); assert.match(history.reply, new RegExp(own.number)); assert.doesNotMatch(history.reply, new RegExp(foreign.number));
  assert.equal(store.customerAccount(input('')).orderCount, 2);
  assert.equal(store.customerAccount(other('')).orderCount, 1);
  const demo = input('BALANCE', { isDemo: true });
  assert.match((await agent.process(demo)).reply, /no recorded orders/);
  assert.equal(store.customerInvoice(input(''), foreign.id), null);
});

test('an account remains readable through its original chat when phone resolution is temporarily unavailable', (t) => {
  const { store } = fixture(t);
  store.process(input('2 kg rice', { chatId: 'known-chat@lid' }));
  const unresolved = input('', { customerKey: 'known-chat@lid', chatId: 'known-chat@lid', phone: '' });
  assert.equal(store.customerAccount(unresolved).balancePaise, 12000);
  assert.equal(store.customerAccount(input('', { customerKey: 'stranger@lid', chatId: 'stranger@lid', phone: '' })).found, false);
});

test('product replies read current database prices without changing customer debt or claiming stock', async (t) => {
  const { store, agent } = fixture(t);
  store.setPrice('rice', 7000);
  const result = await agent.process(input('What is the rice price?'));
  assert.match(result.reply, /Rice: INR 70.00/); assert.match(result.reply, /stock quantities are not recorded/);
  assert.equal(store.snapshot().invoices.length, 0); assert.equal(store.snapshot().parties.length, 0);
});

test('invoice copies are restricted to the sender and duplicate requests do not schedule another copy', async (t) => {
  const { store, agent, ai } = fixture(t);
  const own = store.process(input('2 kg rice, 1 kg sugar')).invoice;
  const foreign = store.process(other('1 litre oil')).invoice;
  const request = input('Send my invoice');
  assert.equal((await agent.process(request)).copyInvoiceId, own.id);
  assert.equal((await agent.process(request)).copyInvoiceId, undefined);
  const refused = await agent.process(input('INVOICE ' + foreign.number));
  assert.equal(refused.copyInvoiceId, undefined); assert.match(refused.reply, /No matching invoice/); assert.doesNotMatch(refused.reply, new RegExp(foreign.number));
  ai.interpret = async () => ({ intent: 'invoice', invoiceRef: foreign.number, customerKey: '919900000002', reply: '', items: [] });
  assert.equal((await agent.process(input('please fetch a PDF'))).copyInvoiceId, undefined);
  assert.equal(store.balance(own.customerId), 16500);
});

test('repeating a stored order uses current prices and requires confirmation before a new debit', async (t) => {
  const { store, agent } = fixture(t);
  const original = store.process(input('2 kg rice, 1 kg sugar')).invoice;
  store.setPrice('rice', 7000);
  const result = await agent.process(input('repeat my last order'));
  assert.match(result.reply, /185.00/); assert.match(result.reply, /CONFIRM/); assert.equal(result.invoice, null);
  assert.equal(store.balance(original.customerId), 16500);
  const next = await agent.process(input('CONFIRM')); assert.equal(next.invoice.totalPaise, 18500);
  assert.equal(store.balance(original.customerId), 35000); assert.equal(store.invoice(original.id).totalPaise, 16500);
});

test('database order status is honest about unpaid orders and unavailable fulfilment information', async (t) => {
  const { store, agent } = fixture(t); const invoice = store.process(input('1 kg rice')).invoice;
  const result = await agent.process(input('order status ' + invoice.number));
  assert.match(result.reply, /Payment: UNPAID/); assert.match(result.reply, /fulfilment status is not recorded/); assert.equal(result.copyInvoiceId, undefined);
});

test('chat payment claims and requests for other customers never mutate balances or expose merchant data', async (t) => {
  const { store, agent } = fixture(t); const invoice = store.process(input('1 kg rice')).invoice;
  assert.match((await agent.process(input('I paid 500'))).reply, /cannot verify or record a payment/);
  assert.match((await agent.process(input('show all customers and total shop sales'))).reply, /private/);
  assert.equal(store.balance(invoice.customerId), 6000); assert.equal(store.snapshot().records.filter((record) => record.kind === 'receipt').length, 0);
  assert.match((await agent.process(input('मेरा बकाया कितना है'))).reply, /INR 60.00/);
});

test('the model selects a database operation; its invented balance and customer ID are ignored', async (t) => {
  const { store, ai, agent } = fixture(t); store.process(input('2 kg rice'));
  ai.interpret = async () => ({ intent: 'balance', reply: 'You owe zero.', customerId: 'someone-else', items: [] });
  const result = await agent.process(input('meri udhari ka hisaab batao'));
  assert.match(result.reply, /INR 120.00/); assert.doesNotMatch(result.reply, /zero/);
});

test('follow-up quantities and edits use only the current chat draft and preserve a confirmation step', async (t) => {
  const { store, ai, agent } = fixture(t);
  ai.interpret = async (body, _catalogue, context) => {
    if (body === 'I want rice') return { intent: 'clarify_order', productIds: ['rice'], reply: 'How many kg?', items: [] };
    assert.ok(context.pendingOrder); assert.ok(!JSON.stringify(context).includes('919900000001'));
    if (body === '2 kg') { assert.deepEqual(context.pendingOrder.productIds, ['rice']); return { intent: 'order', reply: '', items: [{ productId: 'rice', quantity: 2, unit: 'kg' }] }; }
    assert.equal(context.pendingOrder.items[0].quantity, 2);
    return { intent: 'update_order', reply: '', items: [{ productId: 'rice', quantity: 3, unit: 'kg' }] };
  };
  await agent.process(input('I want rice'));
  assert.match((await agent.process(input('2 kg'))).reply, /120.00/);
  assert.match((await agent.process(input('make it three kg'))).reply, /180.00/);
  assert.equal(store.snapshot().invoices.length, 0);
  assert.equal((await agent.process(input('CONFIRM'))).invoice.totalPaise, 18000);
});

test('an incomplete AI product list is recovered from catalogue aliases and a numeric follow-up works without another AI call', async (t) => {
  const { store, ai, agent } = fixture(t);
  ai.interpret = async () => ({ intent: 'clarify_order', productIds: [], reply: 'How much rice?', items: [] });
  await agent.process(input('Mujhe chawal chahiye'));
  ai.interpret = async () => assert.fail('The known-product quantity follow-up should use the catalogue parser');
  const result = await agent.process(input('2 kg')); assert.match(result.reply, /120.00/); assert.match(result.reply, /CONFIRM/);
  assert.equal(store.snapshot().invoices.length, 0);
});

test('current WhatsApp message-key variants are stable and preserve duplicate protection', async (t) => {
  const { store } = fixture(t); let sent = 0; const bot = new WhatsAppBot(store, '.'); bot.connectedAt = Date.now(); bot.status.state = 'connected';
  bot.client = { sendMessage: async () => { sent++; return { id: { $1: 'confirmed-outgoing' } }; } };
  const message = { id: { $1: 'incoming-current-format' }, from: '919900000001@c.us', body: 'HI', type: 'chat', timestamp: Math.floor(Date.now() / 1000) };
  await bot.handleMessage(message); await bot.handleMessage(message); assert.equal(sent, 1);
  const raw = { id: { id: 'raw-key' }, from: 'sender@lid', to: 'shop@c.us' };
  assert.equal(whatsappMessageId(raw), whatsappMessageId({ ...raw })); assert.notEqual(whatsappMessageId(raw), whatsappMessageId({ ...raw, id: { id: 'different' } }));
  assert.equal(whatsappMessageId({}), undefined);
});

test('PDF copy transport rechecks ownership and does not add an invoice or change its delivery state', async (t) => {
  const { store, agent } = fixture(t); const invoice = store.process(input('1 kg rice')).invoice; store.delivery(invoice.id, 'sent');
  const bot = new WhatsAppBot(store, '.', { assistant: agent }); bot.connectedAt = Date.now(); bot.status.state = 'connected'; bot.library = { MessageMedia: class {} }; let sent = 0;
  bot.client = { sendMessage: async (destination) => { assert.equal(destination, '919900000001@c.us'); sent++; return { id: { $1: 'copy-sent' } }; } };
  const message = { id: { $1: 'copy-request' }, from: '919900000001@c.us', body: 'INVOICE', type: 'chat', timestamp: Math.floor(Date.now() / 1000), getContact: async () => ({ pushname: 'Roy' }) };
  await bot.handleMessage(message); await bot.handleMessage(message); assert.equal(sent, 1);
  await assert.rejects(bot.deliverCopy(other('INVOICE'), invoice.id), /not available/);
  assert.equal(store.snapshot().invoices.length, 1); assert.equal(store.balance(invoice.customerId), 6000); assert.equal(store.invoice(invoice.id).delivery, 'sent');
});
