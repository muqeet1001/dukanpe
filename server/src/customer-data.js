import { invoiceText, money } from './orders.js';

export const identityKeys = (input) => [...new Set([input.customerKey, input.chatId, input.phone].filter(Boolean))]
  .map((key) => `${input.isDemo ? 'demo' : 'live'}:${key}`);
export const invoiceReference = (body) => body.match(/\bDK-\d{8}-[a-f\d]{8}\b/i)?.[0]?.toUpperCase() || 'latest';
export const languageOf = (body) => /[\u0900-\u097F]/u.test(body) ? 'hi' : /\b(?:mera|meri|kitna|kitne|chahiye|chawal|baki|baaki|udhaar|pichla|bhejo|daam|bhav)\b/i.test(body) ? 'hinglish' : 'en';
export function matchProducts(body, catalogue) {
  return catalogue.filter((product) => [product.id, product.name, ...product.aliases].some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(body);
  })).map((product) => product.id);
}

export function localRequest(body, catalogue) {
  const text = body.trim().toLowerCase(); const language = languageOf(body); const invoiceRef = invoiceReference(body);
  if (/\b(?:all customers|other customers|customer list|database dump|access token|api key|password|shop revenue|total shop sales)\b/i.test(text)) return { intent: 'restricted', language };
  if (/बकाया|मेरा (?:खाता|हिसाब)/u.test(text)) return { intent: 'balance', language };
  if (/^(?:3|balance|khata|dues?)$|\b(?:what do i owe|how much do i owe|my balance|my dues|mera (?:balance|khata|udhaar)|kitna (?:baki|baaki)|बकाया|मेरा खाता)\b/iu.test(text)) return { intent: 'balance', language };
  if (/\b(?:repeat (?:my |the )?(?:last )?order|same as last time|order again|pichla order phir)\b/i.test(text)) return { intent: 'repeat_order', invoiceRef, language };
  if (/^(?:4|orders|history)$|\b(?:my orders|my last order|order history|what did i order|pichla order|mere orders)\b/i.test(text)) return { intent: 'orders', language };
  if (/\b(?:order status|where is my order|is my order delivered|track my order)\b/i.test(text)) return { intent: 'order_status', invoiceRef, language };
  if (/^(?:5|invoice|bill)$|\b(?:send (?:my |the )?(?:last |latest )?(?:invoice|bill)|my invoice|invoice copy|bill copy)\b|\bDK-\d{8}-[a-f\d]{8}\b/i.test(text)) return { intent: 'invoice', invoiceRef, language };
  if (/\b(?:i (?:have )?paid|i sent (?:the )?money|payment (?:done|sent)|paid already)\b/i.test(text)) return { intent: 'payment', language };
  if (/\b(?:price|rate|cost|available|availability|sell|stock|daam|bhav)\b/i.test(text)) {
    const productIds = matchProducts(body, catalogue);
    if (productIds.length) return { intent: 'product', productIds, language };
  }
  return null;
}

export function balanceText(account, language = 'en') {
  if (!account.found) return language === 'hi' ? 'इस WhatsApp खाते के लिए कोई दर्ज ऑर्डर नहीं मिला। MENU भेजकर ऑर्डर कर सकते हैं।'
    : 'I have no recorded orders for this WhatsApp account. Send MENU to place your first order.';
  const amount = money(account.balancePaise);
  return language === 'hi' ? `आपके दर्ज WhatsApp ऑर्डर का बकाया: ${amount}\nऑर्डर: ${account.orderCount}\n\nयह केवल यहाँ दर्ज WhatsApp ऑर्डर का हिसाब है। दूसरे भुगतान या दुकान की अलग बही की पुष्टि दुकानदार से करें।`
    : language === 'hinglish' ? `Aapke recorded WhatsApp orders ka baki: ${amount}\nOrders: ${account.orderCount}\n\nYeh sirf yahan recorded WhatsApp orders ka hisaab hai. Dusre payments ya shop ki alag khata entries ke liye shopkeeper se confirm karein.`
      : `Your recorded WhatsApp-order balance: ${amount}\nOrders recorded: ${account.orderCount}\n\nThis covers orders recorded here. Payments or separate shop-ledger entries must be confirmed with the shopkeeper.`;
}

export function ordersText(account) {
  if (!account.orders.length) return 'I have no recorded orders for this WhatsApp account. Send MENU to get started.';
  return `Your latest ${account.orders.length} of ${account.orderCount} recorded orders:\n\n${account.orders.map((order) => `${order.number}\n${new Date(order.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} · ${money(order.totalPaise)} · ${order.paymentStatus === 'paid' ? 'PAID' : 'UNPAID'}\n${order.items.map((item) => `${item.quantityMilli / 1000} ${item.unit} ${item.name}`).join(', ')}`).join('\n\n')}\n\nSend INVOICE followed by an invoice number for its PDF, or REPEAT LAST ORDER for a new preview at current prices.`;
}

export function productText(catalogue, productIds) {
  const products = catalogue.filter((product) => productIds.includes(product.id));
  if (!products.length) return 'I could not match that product in the current catalogue. Send MENU for the products and saved prices.';
  return `${products.map((product) => `${product.name}: ${money(product.pricePaise)} / ${product.unit}`).join('\n')}\n\nThese are the current saved catalogue prices. Live stock quantities are not recorded. Send a quantity and product to order, for example: 2 kg rice.`;
}

export function statusText(invoice) {
  if (!invoice) return 'No matching order was found for your WhatsApp account. Send MY ORDERS to see your records.';
  return `Order ${invoice.number}\nRecorded: ${new Date(invoice.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\nTotal: ${money(invoice.totalPaise)}\nPayment: ${invoice.paymentStatus === 'paid' ? 'PAID' : 'UNPAID'}${invoice.paymentReview === 'review' ? '\nScreenshot awaiting merchant verification. Do not pay again.' : invoice.paymentReview === 'rejected' ? '\nScreenshot rejected by merchant. Send PAY NOW to submit the correct screenshot.' : ''}\n\nThis database records the order and invoice. Delivery/fulfilment status is not recorded; please check with the shopkeeper.`;
}

export const invoiceReply = (invoice, shopName) => invoice ? invoiceText(invoice, shopName)
  : 'No matching invoice was found for your WhatsApp account. Send MY ORDERS to see your invoice numbers.';
