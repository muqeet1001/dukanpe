import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { money } from './orders.js';

export const checkoutText = '\n\nHow would you like to settle this order?\n1 · Pay now (UPI QR)\n2 · Khata (pay later)\nReply 1 or 2. You can also send PAY NOW later.';
export const chatKey = (input) => `${input.isDemo ? 'demo' : 'live'}:${input.chatId || input.customerKey}`;
export function upiUri(invoice, upiId, shopName) {
  if (!/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/.test(upiId || '')) throw new Error('Merchant UPI ID is not configured.');
  if (!Number.isSafeInteger(invoice.totalPaise) || invoice.totalPaise < 1) throw new Error('Invalid invoice amount.');
  return 'upi://pay?' + new URLSearchParams({ pa: upiId, pn: shopName.slice(0, 80), am: (invoice.totalPaise / 100).toFixed(2), cu: 'INR', tn: invoice.number, tr: invoice.number });
}
// OCR is evidence extraction, never bank verification. Missing/mismatched fields stay visible.
export function inspectProof(text, invoice, upiId, now = new Date()) {
  const clean = text.replace(/,/g, '');
  const amounts = [...clean.matchAll(/(?:₹|INR\s*|Rs\.?\s*|amount\s*[:\s]*)\s*(\d{1,8}(?:\.\d{1,2})?)\b/gi)].map((m) => Math.round(Number(m[1]) * 100));
  // Some payment apps display only a large number followed by a currency label.
  const amountMatched = amounts.includes(invoice.totalPaise);
  const payeeMatched = Boolean(upiId && clean.toLowerCase().includes(upiId.toLowerCase()));
  const reference = clean.match(/(?:UTR|UPI\s*(?:transaction\s*)?ID|transaction\s*ID|reference\s*(?:no|number|id)?)[\s:#.-]*(\d{10,22})/i)?.[1] || '';
  const successful = /\b(?:successful|success|completed|paid)\b/i.test(clean) && !/\b(?:failed|pending|processing|declined)\b/i.test(clean);
  const warnings = [];
  if (!amountMatched) warnings.push('Invoice amount was not clearly found in the screenshot.');
  if (!payeeMatched) warnings.push('Merchant UPI ID was not clearly found in the screenshot.');
  if (!reference) warnings.push('No readable UPI transaction reference.');
  if (!successful) warnings.push('Successful payment status was not clearly found.');
  const dates = [...clean.matchAll(/\b(\d{1,2})[ /-](\d{1,2})[ /-](20\d{2})\b/g)];
  if (dates.some((m) => new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]) + 1).getTime() < Date.parse(invoice.createdAt))) warnings.push('A visible date predates this invoice.');
  return { amountMatched, payeeMatched, reference, successful, warnings, checkedAt: now.toISOString() };
}
export async function readScreenshot(buffer, cacheDirectory) {
  const { createWorker } = await import('tesseract.js');
  await mkdir(cacheDirectory, { recursive: true });
  let worker; let timer; let cancelled = false;
  try {
    return await Promise.race([
      (async () => {
        worker = await createWorker('eng', 1, { cachePath: cacheDirectory, logger: () => {} });
        if (cancelled) { await worker.terminate(); throw new Error('Screenshot reading timed out.'); }
        return (await worker.recognize(buffer)).data.text.slice(0, 16000);
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { cancelled = true; reject(new Error('Screenshot reading timed out.')); }, 30000); }),
    ]);
  } finally { clearTimeout(timer); if (worker) await worker.terminate(); }
}
export class PaymentService {
  constructor(store, directory, { upiId = '', shopName = store.shopName, ocr = readScreenshot } = {}) {
    this.store = store; this.directory = join(directory, 'payment-proofs'); this.upiId = upiId; this.shopName = shopName; this.ocr = ocr;
  }
  async checkout(input, invoice) {
    await this.store.saveConversation(chatKey(input), { kind: 'checkout', invoiceId: invoice.id, expiresAt: Date.now() + 24 * 60 * 60000 });
  }
  async choose(input, choice, pending) {
    const invoice = await this.store.customerInvoice(input, pending?.invoiceId || 'latest');
    if (!invoice) return this.store.saveReply(input, 'No matching order found. Send MENU to place an order first.');
    if (invoice.paymentStatus === 'paid') return this.store.saveReply(input, `${invoice.number} is already paid. No further payment is needed.`);
    if (choice === 'khata') {
      await this.store.clearConversation(chatKey(input));
      return this.store.saveReply(input, `${invoice.number}: ${money(invoice.totalPaise)} stays in your khata. No extra charge was added. Send BALANCE to see your dues or PAY NOW to settle your latest order.`);
    }
    if (input.isDemo) return this.store.saveReply(input, 'Payment QRs are available only for real WhatsApp orders.');
    if (!this.upiId) return this.store.saveReply(input, 'The shop has not configured its UPI ID yet. Your order is saved in khata. Please contact the shopkeeper.');
    const current = await this.store.payment(invoice.id);
    if (current?.status === 'review') return this.store.saveReply(input, 'Your screenshot is awaiting merchant confirmation. Do not pay again. Send ORDER STATUS for an update.');
    const uri = upiUri(invoice, this.upiId, this.shopName);
    await this.store.saveConversation(chatKey(input), { kind: 'payment', invoiceId: invoice.id, upiId: this.upiId, expiresAt: Date.now() + 24 * 60 * 60000 });
    const result = await this.store.saveReply(input, `Pay ${money(invoice.totalPaise)} to ${this.shopName}\nUPI: ${this.upiId}\nInvoice: ${invoice.number}\n\nScan the QR using your UPI app (or open this image from your gallery). Check the payee before paying. After payment, send the payment screenshot here. The merchant will confirm receipt before your khata is cleared.`);
    return { ...result, paymentQr: { invoiceId: invoice.id, uri } };
  }
  async proof(input, buffer, mime) {
    const existing = await this.store.message(input.messageId, input.isDemo); if (existing) return existing;
    const pending = await this.store.conversation(chatKey(input));
    const invoice = pending?.kind === 'payment' && pending.expiresAt > Date.now() ? await this.store.customerInvoice(input, pending.invoiceId) : null;
    if (!invoice || input.isDemo) return this.store.saveReply(input, 'Please send PAY NOW for your order first, then send its payment screenshot. No payment was recorded.');
    if (invoice.paymentStatus === 'paid') return this.store.saveReply(input, 'This invoice is already paid. No additional receipt was recorded.');
    const expected = mime === 'image/png' ? '89504e470d0a1a0a' : mime === 'image/jpeg' ? 'ffd8ff' : '';
    if (!expected || buffer.length < 20 || buffer.length > 5 * 1024 * 1024 || !buffer.toString('hex', 0, expected.length / 2).startsWith(expected)) return this.store.saveReply(input, 'Send a PNG or JPG payment screenshot under 5 MB. No payment was recorded.');
    const proofId = createHash('sha256').update(buffer).digest('hex');
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, proofId), buffer, { mode: 0o600 });
    let text = ''; let ocrError = false;
    try { text = await this.ocr(buffer, join(this.directory, 'ocr-cache')); } catch { ocrError = true; }
    const checks = inspectProof(text, invoice, pending.upiId);
    if (ocrError) checks.warnings.unshift('Screenshot could not be read automatically. Review the original image.');
    const payment = await this.store.saveProof({ invoiceId: invoice.id, proofId, messageId: input.messageId, mime, upiId: pending.upiId,
      submittedAt: new Date().toISOString(), checks });
    const reply = payment.status === 'confirmed' ? 'This invoice is already paid. No duplicate receipt was added.'
      : payment.status === 'rejected' ? 'The merchant rejected this screenshot. Please send a different, correct payment screenshot or contact the shop. Your khata is unchanged.'
      : payment.status === 'reused' ? 'This screenshot was already submitted for another invoice. Please send the correct screenshot; no payment was recorded.'
        : `Screenshot received for ${invoice.number} (${money(invoice.totalPaise)}).\n${checks.warnings.length ? 'Some details need manual checking. ' : 'The visible amount and payee match. '}Awaiting merchant verification against their received payment. Your khata is unchanged until receipt is confirmed. Do not pay again while this is reviewed.`;
    return this.store.saveReply(input, reply);
  }
  async image(invoiceId, proofId) {
    const payment = await this.store.payment(invoiceId);
    if (!payment || payment.proofId !== proofId || !/^[a-f0-9]{64}$/.test(proofId)) return null;
    return { mime: payment.mime, buffer: await readFile(join(this.directory, proofId)) };
  }
  async qr(uri) { return QRCode.toBuffer(uri, { width: 640, margin: 4, errorCorrectionLevel: 'M' }); }
}
