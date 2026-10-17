export type SetupQr = { type: 'dukanpe-setup'; version: 1; url: string; ticket: string };
export function setupQrFrom(value: string): SetupQr {
  try {
    if (value.length > 2500) throw new Error();
    let payload = value;
    if (!value.trim().startsWith('{')) {
      const link = new URL(value);
      if (!['exp:', 'exps:', 'dukanpe:'].includes(link.protocol) || link.username || link.password || link.hash
        || !((['exp:', 'exps:'].includes(link.protocol) && link.pathname === '/--/whatsapp') || (link.protocol === 'dukanpe:' && link.hostname === 'whatsapp'))) throw new Error();
      payload = link.searchParams.get('setup') || '';
    }
    const data = JSON.parse(payload) as SetupQr;
    const url = new URL(data.url);
    if (data.type !== 'dukanpe-setup' || data.version !== 1 || typeof data.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.ticket)
      || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return { type: data.type, version: data.version, url: url.origin, ticket: data.ticket };
  } catch { throw new Error('Scan the Dukanpe setup QR shown on your computer. WhatsApp linking QRs must be scanned inside WhatsApp.'); }
}
export async function exchangeSetupQr(value: string): Promise<{ url: string; token: string }> {
  const setup = setupQrFrom(value);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(setup.url + '/pairing/exchange', { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: setup.ticket }) });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Setup failed. Scan a fresh QR.');
    if (typeof result.token !== 'string' || result.token.length < 24 || result.token.length > 200) throw new Error('Invalid setup response.');
    return { url: setup.url, token: result.token };
  } catch (reason) {
    if (reason instanceof Error && /abort|fetch|network/i.test(reason.message)) throw new Error('Cannot reach the computer. Use the same Wi-Fi, keep the bot running, then scan a fresh QR.');
    throw reason;
  } finally { clearTimeout(timer); }
}
