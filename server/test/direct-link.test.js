import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DeviceAccess, DirectWhatsAppLink } from '../src/direct-link.js';
import { WhatsAppBot } from '../src/whatsapp.js';
import { createApi } from '../src/api.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dukanpe-direct-link-'));
  const access = new DeviceAccess(directory);
  const bot = { status: { state: 'qr', qr: 'data:image/png;base64,fixture', error: null }, linkEpoch: 'one', stops: 0,
    async start() { this.linkEpoch = String(Number(this.linkEpoch) + 1 || 1); },
    async stop() { this.stops++; this.status = { state: 'idle', qr: null, error: null }; },
  };
  const direct = new DirectWhatsAppLink(bot, access);
  t.after(async () => {
    await direct.clear();
    for (const name of ['authorised-devices.json', 'merchant-account.json']) { const path = join(directory, name); if (existsSync(path)) unlinkSync(path); }
    rmdirSync(directory);
  });
  return { directory, access, bot, direct };
}

test('a fresh app gets the real linking QR without an address/code form, and no business credential before the scan', async (t) => {
  const { bot, direct, access, directory } = fixture(t);
  const first = await direct.start(); assert.equal(first.state, 'qr'); assert.ok(first.qr.startsWith('data:image/png;base64,'));
  assert.match(first.linkToken, /^[A-Za-z0-9_-]{43}$/); assert.equal(first.accessToken, undefined);
  assert.equal((await direct.start('different-device')).state, 'busy');
  await assert.rejects(direct.status('different-device'), /expired/);
  assert.equal((await direct.start(first.linkToken)).qr, first.qr);
  bot.merchantAccount = { id: '919900000001', name: 'Merchant' }; bot.status = { state: 'connected', qr: null, error: null };
  const connected = await direct.status(first.linkToken); assert.equal(connected.state, 'connected'); assert.ok(access.accepts(connected.accessToken, bot.merchantAccount.id));
  assert.equal(access.accepts(connected.accessToken, '919900000002'), false);
  assert.equal((await direct.status(first.linkToken)).accessToken, connected.accessToken);
  assert.ok(!readFileSync(join(directory, 'authorised-devices.json'), 'utf8').includes(connected.accessToken));
  assert.ok(new DeviceAccess(directory).accepts(connected.accessToken, bot.merchantAccount.id));
});

test('an already-connected shop verifies the new app using a separate QR without interrupting customer replies', async (t) => {
  const { bot, direct } = fixture(t); bot.status.state = 'connected'; bot.status.qr = null; bot.merchantAccount = { id: '919900000001' };
  const verifier = { status: { state: 'qr', qr: 'data:image/png;base64,verification', error: null }, linkEpoch: 'verify', merchantAccount: bot.merchantAccount, stops: 0,
    async start() {}, async stop() { this.stops++; } };
  bot.createVerifier = () => verifier;
  const first = await direct.start(); assert.equal(first.qr, verifier.status.qr); assert.equal(bot.stops, 0);
  verifier.status.state = 'connected'; verifier.status.qr = null;
  assert.ok((await direct.status(first.linkToken)).accessToken); assert.equal(bot.stops, 0); assert.equal(verifier.stops, 1);
});

test('wrong merchant, session restart, expiry and takeover cannot release a device credential', async (t) => {
  const { bot, direct } = fixture(t);
  const first = await direct.start(); bot.linkEpoch = 'restarted'; await assert.rejects(direct.status(first.linkToken), /restarted/);
  const next = await direct.start(undefined, true); assert.equal(bot.stops, 1); await assert.rejects(direct.status(first.linkToken), /expired/);
  // A restored account without a freshly displayed QR is insufficient proof for a new app.
  bot.status.state = 'connected'; bot.merchantAccount = { id: '919900000001' };
  bot.createVerifier = () => ({ status: { state: 'starting', qr: null, error: null }, linkEpoch: 'restored-verify', async start() {}, async stop() {} });
  assert.equal((await direct.status(next.linkToken)).accessToken, undefined);
  await direct.clear();
  const verifier = { status: { state: 'qr', qr: 'data:image/png;base64,other', error: null }, linkEpoch: 'verify', merchantAccount: { id: '919900000002' }, async start() {}, async stop() {} };
  bot.createVerifier = () => verifier;
  const wrong = await direct.start(); verifier.status.state = 'connected';
  assert.equal((await direct.status(wrong.linkToken)).state, 'error'); assert.equal((await direct.status(wrong.linkToken)).accessToken, undefined);
  direct.session.expiresAt = 0; await assert.rejects(direct.status(wrong.linkToken), /expired/);
});

test('an account restored during startup switches to a fresh verification QR instead of failing or auto-granting access', async (t) => {
  const { bot, direct } = fixture(t);
  bot.status = { state: 'starting', qr: null, error: null };
  const first = await direct.start(); assert.equal(first.state, 'starting');
  bot.merchantAccount = { id: '919900000001' }; bot.status = { state: 'connected', qr: null, error: null };
  const verifier = { status: { state: 'qr', qr: 'data:image/png;base64,new-device', error: null }, linkEpoch: 'restore-verifier', merchantAccount: bot.merchantAccount, async start() {}, async stop() {} };
  bot.createVerifier = () => verifier;
  const result = await direct.status(first.linkToken); assert.equal(result.state, 'qr'); assert.equal(result.accessToken, undefined); assert.equal(bot.stops, 0);
  verifier.status.state = 'connected'; verifier.status.qr = null;
  assert.ok((await direct.status(first.linkToken)).accessToken);
});

test('merchant account pinning rejects another phone and verification-only clients never change the shop account', (t) => {
  const { directory } = fixture(t); const store = { shopName: 'Test Shop' };
  const bot = new WhatsAppBot(store, directory);
  assert.equal(bot.registerMerchant({ wid: { user: '919900000001' }, pushname: 'Merchant' }), true);
  const restarted = new WhatsAppBot(store, directory); assert.equal(restarted.merchantAccount.id, '919900000001');
  assert.equal(restarted.registerMerchant({ wid: { user: '919900000002' } }), false);
  const verifier = restarted.createVerifier(); assert.equal(verifier.options.verificationOnly, true);
  assert.equal(verifier.registerMerchant({ wid: { user: '919900000002' } }), false);
  assert.equal(JSON.parse(readFileSync(join(directory, 'merchant-account.json'), 'utf8')).id, '919900000001');
});

test('the unauthenticated QR flow exposes no snapshot, then grants scoped device access after merchant scan', async (t) => {
  const { bot, direct, access } = fixture(t);
  const server = createApi({ store: { snapshot: async () => ({ invoices: [], parties: [], records: [] }), shopName: 'Shop' }, bot, token: 'private-admin-token-long-enough', directLink: direct, deviceAccess: access }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve)); t.after(() => server.close());
  const url = 'http://127.0.0.1:' + server.address().port;
  const first = await (await fetch(url + '/connect/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  assert.equal(first.state, 'qr'); assert.equal(first.accessToken, undefined); assert.equal(first.invoices, undefined);
  assert.equal((await fetch(url + '/api/snapshot')).status, 401);
  assert.equal((await fetch(url + '/connect/whatsapp/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkToken: 'wrong' }) })).status, 401);
  bot.merchantAccount = { id: '919900000001' }; bot.status = { state: 'connected', qr: null, error: null };
  const result = await (await fetch(url + '/connect/whatsapp/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkToken: first.linkToken }) })).json();
  assert.ok(result.accessToken); assert.equal((await fetch(url + '/api/snapshot', { headers: { Authorization: 'Bearer ' + result.accessToken } })).status, 200);
  assert.ok(!JSON.stringify(result).includes('private-admin-token-long-enough'));
});
