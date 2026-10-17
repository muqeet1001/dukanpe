import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directLinkRequest, validateLinkReply, LinkRequestError } from '../src/lib/direct-link.ts';

test('direct link responses accept a WhatsApp QR but cannot grant data access before merchant connection', () => {
  assert.equal(validateLinkReply({ state: 'qr', qr: 'data:image/png;base64,test', error: null }).state, 'qr');
  assert.throws(() => validateLinkReply({ state: 'qr', qr: null, error: null, accessToken: 'dk_' + 'a'.repeat(43) }), /invalid response/);
  assert.throws(() => validateLinkReply({ state: 'qr', qr: 'https://external.invalid/qr', error: null }), /invalid response/);
  assert.throws(() => validateLinkReply({ state: 'connected', qr: null, error: null, accessToken: 'short' }), /invalid response/);
});
test('fresh connection asks only for a linking QR, without a pairing credential', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, 'http://shop.local:4000/connect/whatsapp'); assert.deepEqual(JSON.parse(init?.body as string), { replace: false });
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
    return new Response(JSON.stringify({ state: 'qr', qr: 'data:image/png;base64,test', error: null, linkToken: 'a'.repeat(43) }));
  });
  assert.equal((await directLinkRequest('http://shop.local:4000', '/connect/whatsapp')).state, 'qr');
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Link expired. Please retry.' }), { status: 401 }));
  await assert.rejects(directLinkRequest('http://shop.local:4000', '/connect/whatsapp/status', 'a'.repeat(43)), (error) => error instanceof LinkRequestError && error.status === 401);
});
