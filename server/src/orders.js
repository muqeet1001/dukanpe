export const money = (paise) => 'INR ' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const normalise = (text) => text.toLowerCase().normalize('NFKC').replace(/[०-९]/g, (digit) => String('०१२३४५६७८९'.indexOf(digit))).replace(/\s+/g, ' ').trim();
const units = {
  kg: ['kg', 1000], kgs: ['kg', 1000], kilo: ['kg', 1000], kilogram: ['kg', 1000], kilograms: ['kg', 1000], किलो: ['kg', 1000],
  g: ['kg', 1], gm: ['kg', 1], gram: ['kg', 1], grams: ['kg', 1], ग्राम: ['kg', 1],
  l: ['litre', 1000], litre: ['litre', 1000], litres: ['litre', 1000], liter: ['litre', 1000], liters: ['litre', 1000], ltr: ['litre', 1000], लीटर: ['litre', 1000],
  ml: ['litre', 1], packet: ['packet', 1000], packets: ['packet', 1000], pack: ['packet', 1000], packs: ['packet', 1000], pkt: ['packet', 1000], पैकेट: ['packet', 1000],
};
const unitPattern = Object.keys(units).sort((a, b) => b.length - a.length).join('|');
const amount = '(\\d+(?:\\.\\d{1,3})?)';
const quantityFirst = new RegExp('^' + amount + '\\s*(' + unitPattern + ')?\\s+(.+)$', 'u');
const itemFirst = new RegExp('^(.+?)\\s+' + amount + '\\s*(' + unitPattern + ')?$', 'u');

export function validateCatalogue(catalogue) {
  if (!Array.isArray(catalogue) || !catalogue.length || catalogue.length > 100) throw new Error('Catalogue must contain 1–100 products.');
  const seen = new Set();
  for (const item of catalogue) {
    if (!/^[a-z0-9-]{1,40}$/.test(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60
      || !['kg', 'litre', 'packet'].includes(item.unit) || !Number.isSafeInteger(item.pricePaise) || item.pricePaise < 1 || item.pricePaise > 10000000
      || !Array.isArray(item.aliases) || !item.aliases.length) throw new Error('Invalid catalogue product.');
    for (const alias of [item.id, ...item.aliases]) {
      if (typeof alias !== 'string' || !normalise(alias) || alias.length > 60) throw new Error('Invalid product alias.');
    }
    for (const alias of new Set([item.id, ...item.aliases].map(normalise))) {
      if (seen.has(alias)) throw new Error('Catalogue aliases must identify one product.');
      seen.add(alias);
    }
  }
  return catalogue;
}

export function parseOrder(body, catalogue) {
  if (typeof body !== 'string' || !body.trim() || body.length > 2000) return { error: 'Send an order under 2,000 characters.' };
  const text = normalise(body.replace(/\r?\n/g, ',')).replace(/^(?:\/order|order|ऑर्डर)\s*[:\-]?\s*/u, '').replace(/^please\s+/, '');
  const parts = text.split(/\s*(?:,|;|\n|\+|&|\band\b|\baur\b|और)\s*/u).filter(Boolean);
  if (!parts.length || parts.length > 10) return { error: 'Send up to 10 items in one order.' };
  const items = new Map();
  for (const part of parts) {
    const first = quantityFirst.exec(part);
    const last = first ? null : itemFirst.exec(part);
    if (!first && !last) return { error: 'Use a quantity and product for every item, for example: 2 kg rice, 1 kg sugar.' };
    const quantity = Number(first ? first[1] : last[2]);
    const suppliedUnit = first ? first[2] : last[3];
    const alias = normalise(first ? first[3] : last[1]);
    const product = catalogue.find((item) => [item.id, ...item.aliases].some((entry) => normalise(entry) === alias));
    if (!product) return { error: `I could not find “${alias}” in this shop's catalogue. Send MENU for products and prices.` };
    const [unit, multiplier] = suppliedUnit ? units[suppliedUnit] : [product.unit, 1000];
    const rawMilli = quantity * multiplier;
    const quantityMilli = Math.round(rawMilli);
    if (unit !== product.unit) return { error: `${product.name} is sold per ${product.unit}. Please correct its unit.` };
    if (!Number.isFinite(quantity) || quantityMilli < 1 || quantityMilli > 1000000 || Math.abs(quantityMilli - rawMilli) > 0.00001
      || (unit === 'packet' && quantityMilli % 1000 !== 0)) return { error: `Please send a valid quantity for ${product.name}.` };
    const combined = quantityMilli + (items.get(product.id)?.quantityMilli ?? 0);
    if (combined > 1000000) return { error: 'Maximum quantity is 1,000 units per product.' };
    items.set(product.id, { productId: product.id, name: product.name, unit, quantityMilli: combined, unitPricePaise: product.pricePaise,
      totalPaise: Math.round(combined * product.pricePaise / 1000) });
  }
  const lines = [...items.values()];
  const totalPaise = lines.reduce((sum, item) => sum + item.totalPaise, 0);
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 1 || totalPaise > 1000000000) return { error: 'Order total is outside the supported range.' };
  return { items: lines, totalPaise };
}

export function menuText(catalogue, shopName) {
  return `${shopName}\n\n${catalogue.map((item) => `${item.name}: ${money(item.pricePaise)} / ${item.unit}`).join('\n')}\n\nOrder like this:\n2 kg rice, 1 kg sugar\n\nOrders create an unpaid invoice and add the amount to your khata. Prices are taken from this catalogue.`;
}

export function invoiceText(invoice, shopName) {
  return `${shopName}\nORDER INVOICE ${invoice.number}\n${invoice.isDemo ? 'SIMULATED ORDER\n' : ''}\n${invoice.items.map((item) => `${item.quantityMilli / 1000} ${item.unit} ${item.name}: ${money(item.totalPaise)}`).join('\n')}\n\nTotal: ${money(invoice.totalPaise)}\nPayment: UNPAID — added to khata\nWhatsApp-order balance after this invoice: ${money(invoice.balanceAfterPaise)}\n\nNo payment has been recorded. No tax calculated.`;
}
