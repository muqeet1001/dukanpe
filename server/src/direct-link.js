import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const digest = (value) => createHash('sha256').update(value).digest('hex');
export class DeviceAccess {
  constructor(directory) {
    this.path = join(directory, 'authorised-devices.json');
    try { this.devices = JSON.parse(readFileSync(this.path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Saved device access could not be loaded.'); this.devices = []; }
    if (!Array.isArray(this.devices)) throw new Error('Invalid saved device access.');
  }
  issue(merchantId) {
    const token = 'dk_' + randomBytes(32).toString('base64url');
    const devices = [...this.devices.slice(-49), { hash: digest(token), merchantId, createdAt: new Date().toISOString() }];
    writeFileSync(this.path, JSON.stringify(devices), { mode: 0o600 }); this.devices = devices;
    return token;
  }
  accepts(token, merchantId) {
    return typeof token === 'string' && /^dk_[A-Za-z0-9_-]{43}$/.test(token)
      && this.devices.some((device) => device.hash === digest(token) && device.merchantId === merchantId);
  }
}

export class DirectWhatsAppLink {
  constructor(bot, access, { now = () => Date.now() } = {}) { this.bot = bot; this.access = access; this.now = now; this.session = null; this.startQueue = Promise.resolve(); }
  async clear() {
    const current = this.session; this.session = null;
    if (current?.timer) clearTimeout(current.timer);
    if (current && (current.target !== this.bot || current.target.status.state !== 'connected')) await current.target.stop({ preserveEnabled: true }).catch(() => undefined);
  }
  start(linkToken, replace = false) {
    const task = this.startQueue.then(() => this.open(linkToken, replace));
    this.startQueue = task.catch(() => undefined); return task;
  }
  async open(linkToken, replace = false) {
    if (this.session && this.session.expiresAt <= this.now()) await this.clear();
    if (this.session) {
      if (this.session.linkToken === linkToken && !['error', 'disconnected'].includes(this.session.target.status.state)) return this.status(linkToken);
      if (this.session.accessToken || replace || this.session.linkToken === linkToken) await this.clear();
      else return { state: 'busy', qr: null, error: 'A WhatsApp link is open on another device. Finish that scan or try again in a few minutes.' };
    }
    // A connected bot keeps serving customers. A temporary, message-free WhatsApp
    // session verifies another app device against the same merchant account.
    const target = this.bot.status.state === 'connected' ? this.bot.createVerifier() : this.bot;
    const session = { linkToken: randomBytes(32).toString('base64url'), target, expiresAt: this.now() + 5 * 60000, sawQr: false };
    this.session = session;
    session.timer = setTimeout(() => { if (this.session === session) void this.clear(); }, 5 * 60000); session.timer.unref();
    try {
      if (['error', 'disconnected'].includes(target.status.state)) await target.stop({ preserveEnabled: true });
      await target.start(); session.epoch = target.linkEpoch;
      return { ...await this.status(session.linkToken), linkToken: session.linkToken };
    } catch { await this.clear(); throw new Error('WhatsApp could not open. Keep the computer running and try again.'); }
  }
  async status(linkToken) {
    const session = this.session;
    if (!session || typeof linkToken !== 'string' || session.linkToken !== linkToken || session.expiresAt <= this.now()) {
      const error = new Error('This linking screen expired. Tap Show WhatsApp QR to start again.'); error.status = 401; throw error;
    }
    if (session.accessToken) return { state: 'connected', qr: null, error: null, accessToken: session.accessToken };
    const status = session.target.status;
    if (session.epoch !== undefined && session.target.linkEpoch !== session.epoch) {
      const error = new Error('WhatsApp restarted. Tap Show WhatsApp QR again.'); error.status = 409; throw error;
    }
    if (status.state === 'qr' && status.qr) session.sawQr = true;
    if (status.state === 'connected') {
      // LocalAuth may restore the shop while the initial QR request is opening.
      // A fresh app still needs its own scan; switch to an isolated verifier.
      if (!session.sawQr && session.target === this.bot && this.bot.merchantAccount?.id) {
        session.target = this.bot.createVerifier(); await session.target.start(); session.epoch = session.target.linkEpoch;
        return this.status(linkToken);
      }
      const merchant = session.target.merchantAccount;
      if (!session.sawQr || !merchant?.id || merchant.id !== this.bot.merchantAccount?.id) return { state: 'error', qr: null, error: 'The merchant account could not be verified. Please open a fresh WhatsApp linking QR.' };
      session.accessToken = this.access.issue(merchant.id);
      if (session.target !== this.bot) void session.target.stop().catch(() => undefined);
      return { state: 'connected', qr: null, error: null, accessToken: session.accessToken };
    }
    // Only connection status and the linking QR are exposed before authentication.
    return { state: status.state, qr: status.qr, error: status.error, expiresAt: session.expiresAt };
  }
}
