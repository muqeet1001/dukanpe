import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

export function setupPairing({ token, baseUrl, encodeQr = QRCode.toDataURL, now = () => Date.now() } = {}) {
  const tickets = new Map();
  const attempts = new Map();
  const consume = (ticket) => {
    const expires = tickets.get(ticket); tickets.delete(ticket);
    return typeof ticket === 'string' && typeof expires === 'number' && expires > now();
  };
  return {
    async issue(req) {
      for (const [key, expires] of tickets) if (expires <= now()) tickets.delete(key);
      if (tickets.size >= 10) tickets.delete(tickets.keys().next().value);
      const url = new URL(baseUrl || 'http://' + req.get('host'));
      if (!baseUrl && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        const addresses = Object.values(networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(a.address));
        if (addresses[0]) url.hostname = addresses[0].address;
      }
      const ticket = randomBytes(32).toString('base64url'); const expiresAt = now() + 2 * 60000;
      tickets.set(ticket, expiresAt);
      const payload = JSON.stringify({ type: 'dukanpe-setup', version: 1, url: url.origin, ticket });
      const launchUrl = req.body?.mode === 'expo' ? `exp://${url.hostname}:8081/--/whatsapp?setup=${encodeURIComponent(payload)}` : null;
      return { qr: await encodeQr(launchUrl || payload, { width: 340, margin: 4, errorCorrectionLevel: 'M' }), expiresAt, url: url.origin, launchUrl };
    },
    exchange(req, res) {
      const address = req.socket.remoteAddress || 'unknown'; const time = now();
      for (const [key, value] of attempts) if (time - value.since >= 60000) attempts.delete(key);
      const state = attempts.get(address) || { since: time, count: 0 }; state.count++; attempts.set(address, state);
      if (state.count > 30) return res.status(429).json({ error: 'Too many setup attempts. Wait a minute and scan a fresh QR.' });
      if (!consume(req.body?.ticket)) return res.status(401).json({ error: 'Setup QR expired or was already used. Generate a new QR on the computer.' });
      res.json({ token });
    },
  };
}
