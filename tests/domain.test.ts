import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerQuestion, businessReducer, createDemoState, parseAmount, partyBalance, totals } from '../src/lib/domain.ts';

test('sample dashboard separates sales, receipts, dues and unconfirmed alerts', () => {
  const state = createDemoState();
  assert.deepEqual(totals(state), { sales: 1245000, receipts: 920000, dues: 1875000, review: 3, followUps: 4 });
  assert.equal(partyBalance(state, 'roy'), 50000);
});

test('confirmation reduces Roy’s balance once even when the command is repeated', () => {
  const initial = createDemoState();
  const confirmed = businessReducer(initial, { type: 'confirm-payment', id: 'roy-alert' });
  assert.equal(partyBalance(confirmed, 'roy'), 30000);
  assert.equal(totals(confirmed).receipts, 940000);
  assert.equal(totals(confirmed).sales, totals(initial).sales);
  const retried = businessReducer(confirmed, { type: 'confirm-payment', id: 'roy-alert' });
  assert.strictEqual(retried, confirmed);
  assert.equal(retried.followUps.find((item) => item.id === 'payment-review')?.status, 'done');
});

test('a receipt can remain unmatched without changing a customer’s khata', () => {
  const initial = createDemoState();
  const state = businessReducer(initial, { type: 'confirm-payment', id: 'roy-alert', partyId: null });
  assert.equal(partyBalance(state, 'roy'), 50000);
  assert.equal(state.records.find((item) => item.id === 'roy-alert')?.partyId, undefined);
  assert.equal(totals(state).receipts, 940000);
});

test('invalid customer identity cannot confirm a payment', () => {
  const initial = createDemoState();
  assert.strictEqual(businessReducer(initial, { type: 'confirm-payment', id: 'roy-alert', partyId: 'missing' }), initial);
});

test('cash sale records equal sale and receipt with no change in customer dues', () => {
  const initial = createDemoState();
  const input = { id: 'test-paid', partyId: 'roy', amountPaise: 12550, paid: true, description: 'Rice', createdAt: new Date().toISOString() };
  const state = businessReducer(initial, { type: 'add-sale', input });
  assert.equal(totals(state).sales, totals(initial).sales + 12550);
  assert.equal(totals(state).receipts, totals(initial).receipts + 12550);
  assert.equal(partyBalance(state, 'roy'), 50000);
  assert.strictEqual(businessReducer(state, { type: 'add-sale', input }), state);
});

test('credit sale requires a customer and increases their balance', () => {
  const initial = createDemoState();
  const input = { id: 'test-credit', amountPaise: 10000, paid: false, description: 'Milk', createdAt: new Date().toISOString() };
  assert.strictEqual(businessReducer(initial, { type: 'add-sale', input }), initial);
  const state = businessReducer(initial, { type: 'add-sale', input: { ...input, partyId: 'roy' } });
  assert.equal(partyBalance(state, 'roy'), 60000);
  assert.equal(totals(state).receipts, totals(initial).receipts);
});

test('money is parsed as exact integer paise and invalid values are rejected', () => {
  assert.equal(parseAmount('200.50'), 20050);
  assert.equal(parseAmount('1,250'), 125000);
  assert.equal(parseAmount('0.01'), 1);
  for (const value of ['0', '-1', '1.005', '1e3', 'NaN', '', '  ']) assert.equal(parseAmount(value), null);
});

test('completing a task does not change sales, receipts or balances', () => {
  const initial = createDemoState();
  const state = businessReducer(initial, { type: 'follow-up', id: 'roy-promise', done: true });
  assert.equal(totals(state).followUps, 3);
  assert.equal(totals(state).dues, totals(initial).dues);
  assert.equal(totals(state).receipts, totals(initial).receipts);
});

test('assistant uses confirmed balance and discloses unconfirmed alerts', () => {
  const answer = answerQuestion('What does Roy owe?', createDemoState());
  assert.match(answer.text, /₹500/);
  assert.match(answer.text, /awaiting confirmation/);
  assert.ok(answer.recordIds.includes('roy-alert'));
});

test('today’s totals exclude older confirmed sales', () => {
  const state = createDemoState(new Date(2026, 9, 16, 10));
  const summary = totals(state, new Date(2026, 9, 17, 10));
  assert.equal(summary.sales, 0);
  assert.equal(summary.receipts, 0);
  assert.equal(summary.dues, 1875000);
});
