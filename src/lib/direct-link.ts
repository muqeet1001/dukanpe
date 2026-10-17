export type LinkStatus = { state: 'idle' | 'starting' | 'qr' | 'authenticating' | 'connected' | 'disconnected' | 'error' | 'busy'; qr: string | null; error: string | null; expiresAt?: number };
export type LinkReply = LinkStatus & { linkToken?: string; accessToken?: string };
export class LinkRequestError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
export function validateLinkReply(data: LinkReply): LinkReply {
  if (!data || !['idle', 'starting', 'qr', 'authenticating', 'connected', 'disconnected', 'error', 'busy'].includes(data.state)
    || (data.qr !== null && (typeof data.qr !== 'string' || !data.qr.startsWith('data:image/png;base64,')))
    || (data.error !== null && typeof data.error !== 'string')
    || (data.linkToken !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(data.linkToken))
    || (data.accessToken !== undefined && (data.state !== 'connected' || !/^dk_[A-Za-z0-9_-]{43}$/.test(data.accessToken)))) throw new Error('The WhatsApp connection returned an invalid response. Tap retry.');
  return data;
}
export async function directLinkRequest(url: string, path: '/connect/whatsapp' | '/connect/whatsapp/status', linkToken?: string, replace = false): Promise<LinkReply> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url + path, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkToken, replace }) });
    const data = await response.json();
    if (!response.ok) throw new LinkRequestError(typeof data.error === 'string' ? data.error : 'WhatsApp could not connect. Please retry.', response.status);
    return validateLinkReply(data);
  } catch (reason) {
    if (reason instanceof Error && /abort|network|fetch/i.test(reason.message)) throw new Error('Cannot reach your shop. Keep the computer running and connect both devices to the same Wi-Fi, then retry.');
    throw reason;
  } finally { clearTimeout(timer); }
}
