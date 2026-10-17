import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Script, runInNewContext } from 'node:vm';
import { patchWhatsAppUtils } from '../scripts/patch-whatsapp.js';

const fixture = `function send(newMsgKey, mediaOptions) {
        const message = { id: newMsgKey, ...mediaOptions };
        // Bot's won't reply if canonicalUrl is set (linking)
        globalThis.captured = message;
        return window.require('WAWebCollections').Msg.get(newMsgKey._serialized);
}`;

test('compatibility fixes preserve modern and legacy outgoing IDs and discard corrupt media identity', () => {
  const patched = patchWhatsAppUtils(fixture, '1.34.7');
  for (const key of [{ $1: 'modern-id' }, { _serialized: 'legacy-id' }]) {
    const context = { key, media: { __x_id: undefined, caption: 'test' }, window: { require: () => ({ Msg: { get: (id) => { assert.ok(id); return id; } } }) } };
    const id = runInNewContext(patched + ';send(key, media)', context);
    assert.equal(id, key._serialized || key.$1); assert.equal(context.captured.id, key);
    assert.equal(Object.hasOwn(context.captured, '__x_id'), false);
  }
  assert.equal(patchWhatsAppUtils(patched, '1.34.7'), patched);
  assert.throws(() => patchWhatsAppUtils(fixture, '1.35.0'), /Review/);
});

test('the real installed WhatsApp utility source accepts the patch and remains valid JavaScript', () => {
  const require = createRequire(import.meta.url);
  const source = readFileSync(require.resolve('whatsapp-web.js/src/util/Injected/Utils.js'), 'utf8');
  const patched = patchWhatsAppUtils(source, '1.34.7');
  assert.doesNotThrow(() => new Script(patched));
  assert.ok(patched.includes('newMsgKey._serialized || newMsgKey.$1'));
  assert.ok(patched.includes('delete message.__x_id;'));
});
