import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MongoStore } from '../src/mongo-store.js';
import { WhatsAppAssistant } from '../src/assistant.js';

const catalogue = JSON.parse(readFileSync(new URL('../catalogue.json', import.meta.url), 'utf8'));

test('MongoDB transactions, concurrent deduplication, named khata and persisted AI confirmations', { skip: !process.env.MONGODB_URI }, async (t) => {
  const prefix = 'dukanpe_test_' + randomUUID().replaceAll('-', '') + '_';
  const store = await MongoStore.connect(process.env.MONGODB_URI, process.env.MONGODB_DB || undefined, catalogue, 'Integration Test Shop', { prefix });
  t.after(async () => {
    // Only remove the disposable collections created by this test; never drop the database.
    assert.match(prefix, /^dukanpe_test_[a-f0-9]{32}_$/);
    for (const collection of Object.values(store.collections)) { assert.ok(collection.collectionName.startsWith(prefix)); await collection.drop(); }
    await store.close();
  });
  const message = (body, patch = {}) => ({ messageId: randomUUID(), customerKey: 'test-customer', chatId: 'test-chat@lid', name: 'Test Customer', phone: '', body, isDemo: true, ...patch });
  assert.match((await store.process(message('HI'))).reply, /Welcome/);
  const order = message('2 kg rice, 1 kg sugar');
  const results = await Promise.all([store.process(order), store.process(order)]);
  assert.equal(results[0].invoice.id, results[1].invoice.id); assert.equal(await store.balance(results[0].invoice.customerId), 16500);
  const concurrent = await Promise.all([store.process(message('1 kg rice')), store.process(message('1 kg sugar'))]);
  assert.equal(await store.balance(results[0].invoice.customerId), 27000);
  assert.equal(Math.max(...concurrent.map((result) => result.invoice.balanceAfterPaise)), 27000);
  const assistant = new WhatsAppAssistant(store, { interpret: async () => ({ intent: 'order', reply: 'Check order', items: [{ productId: 'rice', quantity: 1, unit: 'kg' }] }) });
  assert.match((await assistant.process(message('ek kilo chawal please'))).reply, /CONFIRM/);
  const restarted = new WhatsAppAssistant(store, { interpret: async () => assert.fail('Confirmation cannot need an AI call') });
  await store.setPrice('rice', 7000);
  const changed = await restarted.process(message('CONFIRM'));
  assert.equal(changed.invoice, null); assert.match(changed.reply, /prices changed/);
  const confirm = message('CONFIRM'); const confirmed = await restarted.process(confirm);
  assert.equal(confirmed.invoice.totalPaise, 7000); assert.equal((await restarted.process(confirm)).invoice.id, confirmed.invoice.id);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.invoices.length, 4); assert.equal(snapshot.parties.length, 1); assert.equal(snapshot.parties[0].name, 'Test Customer');
  assert.equal(snapshot.records.filter((record) => record.kind === 'sale').length, 4);
  assert.equal(await store.balance(snapshot.parties[0].id), 34000);
  assert.ok(snapshot.invoices.every((invoice) => !('destination' in invoice)));
});
