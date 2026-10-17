import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupPairing } from '../src/setup-pairing.js';
import { createApi } from '../src/api.js';

test('setup QR contains a short-lived single-use ticket, never the permanent merchant credential', async () => {
  let payload; let clock = Date.now();
  const pairing = setupPairing({ token: 'permanent-private-merchant-token', baseUrl: 'http://192.168.1.5:4000', now: () => clock,
    encodeQr: async (text) => { payload = JSON.parse(text); return 'data:image/png;base64,test'; } });
  const issued = await pairing.issue({});
  assert.equal(issued.url, 'http://192.168.1.5:4000'); assert.equal(payload.type, 'dukanpe-setup');
  assert.equal(payload.version, 1); assert.match(payload.ticket, /^[A-Za-z0-9_-]{43}$/); assert.ok(!JSON.stringify(payload).includes('permanent-private'));
  const exchange = (ticket) => { const res = { code: 200, data: null, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } }; pairing.exchange({ body: { ticket }, socket: { remoteAddress: 'test-client' } }, res); return res; };
  assert.equal(exchange(payload.ticket).data.token, 'permanent-private-merchant-token');
  assert.equal(exchange(payload.ticket).code, 401);
  await pairing.issue({}); clock += 120001; assert.equal(exchange(payload.ticket).code, 401);
  for (let i = 0; i < 31; i++) exchange('invalid');
  assert.equal(exchange('invalid').code, 429);
});

test('only an authenticated merchant can generate setup QRs; public exchange rejects unknown tickets', async (t) => {
  const token = 'private-test-token-over-twenty-four-chars';
  const app = createApi({ store: {}, bot: {}, token, pairingBaseUrl: 'http://192.168.1.5:4000' });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/api/pairing/qr', { method: 'POST' })).status, 401);
  const result = await fetch(base + '/api/pairing/qr', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  assert.equal(result.status, 200); const data = await result.json(); assert.ok(data.qr.startsWith('data:image/png;base64,'));
  assert.ok(!JSON.stringify(data).includes(token)); assert.equal(data.url, 'http://192.168.1.5:4000');
  const invalid = await fetch(base + '/pairing/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: 'invalid' }) });
  assert.equal(invalid.status, 401); assert.ok(!(await invalid.text()).includes(token));
});

test('Expo Go launch QR opens the WhatsApp screen with a single-use setup ticket', async () => {
  let captured;
  const pairing = setupPairing({ token: 'private-permanent-credential', baseUrl: 'http://192.168.1.5:4000', encodeQr: async (text) => { captured = text; return 'data:image/png;base64,test'; } });
  const result = await pairing.issue({ body: { mode: 'expo' } });
  const launch = new URL(captured); assert.equal(launch.protocol, 'exp:'); assert.equal(launch.host, '192.168.1.5:8081');
  assert.equal(launch.pathname, '/--/whatsapp'); const setup = JSON.parse(launch.searchParams.get('setup'));
  assert.equal(setup.type, 'dukanpe-setup'); assert.equal(setup.url, 'http://192.168.1.5:4000');
  assert.equal(result.launchUrl, captured); assert.ok(!captured.includes('private-permanent-credential'));
});
