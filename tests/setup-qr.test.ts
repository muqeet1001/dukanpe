import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupQrFrom, exchangeSetupQr } from '../src/lib/setup-qr.ts';

const valid = { type: 'dukanpe-setup', version: 1, url: 'http://192.168.1.5:4000', ticket: 'a'.repeat(43) };
test('scanner accepts only Dukanpe setup tickets and rejects WhatsApp, payment and malformed QR data', () => {
  assert.deepEqual(setupQrFrom(JSON.stringify(valid)), valid);
  assert.deepEqual(setupQrFrom('exp://192.168.1.5:8081/--/whatsapp?setup=' + encodeURIComponent(JSON.stringify(valid))), valid);
  for (const value of ['upi://pay?pa=merchant@upi', 'whatsapp-linking-payload', JSON.stringify({ ...valid, version: 2 }), JSON.stringify({ ...valid, ticket: 'short' }),
    JSON.stringify({ ...valid, url: 'https://user:password@example.com/' }), JSON.stringify({ ...valid, url: 'javascript:alert(1)' }), JSON.stringify({ ...valid, url: 'https://example.com/private' })]) {
    assert.throws(() => setupQrFrom(value), /Dukanpe setup QR/);
  }
  assert.throws(() => setupQrFrom('exp://192.168.1.5:8081/--/other?setup=' + encodeURIComponent(JSON.stringify(valid))), /Dukanpe setup QR/);
});
test('scanning exchanges only the temporary ticket and returns a validated connection; expiry remains actionable', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, valid.url + '/pairing/exchange'); assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(init?.body as string), { ticket: valid.ticket }); assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
    return new Response(JSON.stringify({ token: 'merchant-pairing-token-long-enough' }));
  });
  assert.deepEqual(await exchangeSetupQr(JSON.stringify(valid)), { url: valid.url, token: 'merchant-pairing-token-long-enough' });
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Setup QR expired or was already used.' }), { status: 401 }));
  await assert.rejects(exchangeSetupQr(JSON.stringify(valid)), /expired or was already used/);
});
