import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Narrow workarounds for wwebjs upstream issues #201852 and #201921.
// Review/remove these guards when upgrading the pinned library version.
export function patchWhatsAppUtils(source, version) {
  if (version !== '1.34.7') throw new Error('Review WhatsApp compatibility fixes before changing whatsapp-web.js from 1.34.7.');
  let result = source.replace(/\r\n/g, '\n');
  const replacements = [
    ['.Msg.get(newMsgKey._serialized);', '.Msg.get(newMsgKey._serialized || newMsgKey.$1);'],
    ["        // Bot's won't reply if canonicalUrl is set (linking)",
      "        // Dukanpe: media internals must not replace the outgoing message key.\n        delete message.__x_id;\n\n        // Bot's won't reply if canonicalUrl is set (linking)"],
  ];
  for (const [before, after] of replacements) {
    if (result.includes(after)) continue;
    if (result.split(before).length !== 2) throw new Error('WhatsApp source changed; compatibility patch was not applied.');
    result = result.replace(before, after);
  }
  return result;
}

export function applyCompatibilityPatch() {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('whatsapp-web.js'));
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const path = join(root, 'src', 'util', 'Injected', 'Utils.js');
  const original = readFileSync(path, 'utf8'); const patched = patchWhatsAppUtils(original, version);
  if (original !== patched) writeFileSync(path, patched);
  console.log('WhatsApp 1.34.7 compatibility fixes ready: message IDs and media.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) applyCompatibilityPatch();
