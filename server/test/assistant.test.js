import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { WhatsAppAssistant } from '../src/assistant.js';
import { GroqAI } from '../src/groq.js';

const catalogue = JSON.parse(readFileSync(new URL('../catalogue.json', import.meta.url), 'utf8'));
const input = (body, patch = {}) => ({ messageId: randomUUID(), customerKey: '919900000001', chatId: '919900000001@c.us', name: 'Roy', phone: '919900000001', body, ...patch });
const interpreted = { intent: 'order', reply: 'Please check your order.', items: [{ productId: 'rice', quantity: 2, unit: 'kg' }, { productId: 'sugar', quantity: 1, unit: 'kg' }] };
function setup(t) { const store = new Store(':memory:', catalogue, 'Test Shop'); t.after(() => store.close()); const ai = { interpret: async () => interpreted }; return { store, ai, assistant: new WhatsAppAssistant(store, ai) }; }

test('AI interprets an order, asks confirmation, and books one named invoice and debit', async (t) => {
  const { store, assistant } = setup(t);
  const message = input('do kilo chawal aur ek kilo cheeni chahiye');
  const preview = await assistant.process(message); assert.equal(preview.invoice, null); assert.match(preview.reply, /INR 165.00/); assert.match(preview.reply, /CONFIRM/);
  assert.equal(store.snapshot().invoices.length, 0);
  const confirm = input('CONFIRM'); const booked = await assistant.process(confirm);
  assert.equal(booked.invoice.totalPaise, 16500); assert.equal(booked.invoice.customerName, 'Roy');
  assert.equal(booked.invoice.sourceBody, message.body);
  assert.equal((await assistant.process(confirm)).invoice.id, booked.invoice.id);
  assert.equal(store.balance(booked.invoice.customerId), 16500);
  assert.equal((await assistant.process(input('CONFIRM'))).invoice, null);
  assert.equal(store.snapshot().invoices.length, 1);
  assert.match((await assistant.process(input('CANCEL'))).reply, /Existing invoices and khata entries are unchanged/);
  assert.equal(store.balance(booked.invoice.customerId), 16500);
});

test('a price change after the AI preview requires a second confirmation at the new total', async (t) => {
  const { store, assistant } = setup(t);
  await assistant.process(input('please get me do kilo rice aur ek kilo sugar'));
  store.setPrice('rice', 7000);
  const changed = await assistant.process(input('CONFIRM')); assert.equal(changed.invoice, null); assert.match(changed.reply, /prices changed/); assert.match(changed.reply, /185.00/);
  assert.equal(store.snapshot().invoices.length, 0);
  assert.equal((await assistant.process(input('CONFIRM'))).invoice.totalPaise, 18500);
});

test('a restart/crash after booking cannot turn a fresh CONFIRM into another debit', async (t) => {
  const { store, assistant, ai } = setup(t);
  await assistant.process(input('do kilo rice aur ek kilo sugar'));
  const original = store.clearConversation.bind(store); let failOnce = true;
  store.clearConversation = (key) => { if (failOnce) { failOnce = false; throw new Error('Simulated process interruption'); } return original(key); };
  await assert.rejects(assistant.process(input('CONFIRM')), /Simulated process interruption/);
  assert.equal(store.snapshot().invoices.length, 1);
  const restarted = new WhatsAppAssistant(store, ai);
  const result = await restarted.process(input('CONFIRM'));
  assert.equal(result.invoice.totalPaise, 16500); assert.equal(store.balance(result.invoice.customerId), 16500);
  assert.equal(store.snapshot().invoices.length, 1);
});

test('cancelled and expired previews cannot create invoices; another chat cannot confirm them', async (t) => {
  const { store, assistant } = setup(t);
  await assistant.process(input('please send do kilo rice aur ek kilo sugar'));
  assert.equal((await assistant.process(input('CONFIRM', { customerKey: 'another', chatId: 'another@lid' }))).invoice, null);
  assert.match((await assistant.process(input('CANCEL'))).reply, /discarded/);
  assert.equal((await assistant.process(input('CONFIRM'))).invoice, null);
  await assistant.process(input('do kilo chawal aur ek kilo sugar'));
  const key = 'live:919900000001@c.us'; store.saveConversation(key, { ...store.conversation(key), expiresAt: Date.now() - 1000 });
  assert.equal((await assistant.process(input('CONFIRM'))).invoice, null);
  assert.equal(store.snapshot().invoices.length, 0);
});

test('AI failures and invalid products create no debt; strict orders and menu stay available', async (t) => {
  const { store, assistant, ai } = setup(t);
  ai.interpret = async () => ({ ...interpreted, items: [{ productId: 'unknown', quantity: 1, unit: 'kg' }] });
  assert.equal((await assistant.process(input('some new product please'))).invoice, null);
  ai.interpret = async () => null;
  assert.equal((await assistant.process(input('vague order'))).invoice, null);
  assert.match((await assistant.process(input('HI'))).reply, /Welcome/);
  assert.match((await assistant.process(input('MENU'))).reply, /Rice/);
  assert.equal(store.snapshot().invoices.length, 0);
  ai.interpret = async () => assert.fail('Explicit orders must not need an AI call');
  assert.equal((await assistant.process(input('2 kg rice, 1 kg sugar'))).invoice.totalPaise, 16500);
});

test('the Groq adapter validates model JSON and backs off instead of retrying a rate limit', async () => {
  const response = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) });
  const ai = new GroqAI({ apiKey: 'test-only', fetcher: async () => response(interpreted) });
  assert.equal((await ai.interpret('order', catalogue)).intent, 'order');
  ai.fetcher = async () => response({ ...interpreted, items: [{ productId: 'made-up', quantity: 3, unit: 'kg' }] });
  assert.equal(await ai.interpret('order', catalogue), null);
  ai.fetcher = async () => response({ ...interpreted, items: [{ productId: 'rice', quantity: -2, unit: 'kg' }] });
  assert.equal(await ai.interpret('order', catalogue), null);
  let calls = 0; ai.fetcher = async () => { calls++; return { ok: false, status: 429 }; };
  assert.equal(await ai.interpret('order', catalogue), null); assert.equal(await ai.interpret('order', catalogue), null); assert.equal(calls, 1);
});
