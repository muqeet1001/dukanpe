import { chatKey } from './payments.js';
import { chatCommand, menuText, money, parseOrder, validateIncoming } from './orders.js';
import { createHash } from 'node:crypto';
import { balanceText, invoiceReply, languageOf, localRequest, matchProducts, ordersText, productText, statusText } from './customer-data.js';

const fingerprint = (parsed) => JSON.stringify(parsed.items.map(({ productId, quantityMilli, unit, unitPricePaise, totalPaise }) => ({ productId, quantityMilli, unit, unitPricePaise, totalPaise })));
const preview = (parsed) => `Please check your order:\n\n${parsed.items.map((item) => `${item.quantityMilli / 1000} ${item.unit} ${item.name} · ${money(item.totalPaise)}`).join('\n')}\n\nTotal: ${money(parsed.totalPaise)}\n\nReply CONFIRM to receive your invoice and add this unpaid total to khata. Reply CANCEL to discard.\nNothing has been added yet.`;

export class WhatsAppAssistant {
  constructor(store, ai, payments) { this.store = store; this.ai = ai; this.payments = payments; }
  async completed(input, result) {
    if (result.invoice && this.payments && !result.duplicate) await this.payments.checkout(input, result.invoice);
    return result;
  }
  async previewOrder(input, orderBody, sourceBody = input.body) {
    const parsed = parseOrder(orderBody, await this.store.catalogue());
    if (parsed.error) return this.store.saveReply(input, parsed.error + '\n\nSend MENU to see prices. Nothing has been added to khata.');
    const chatKey = `${input.isDemo ? 'demo' : 'live'}:${input.chatId || input.customerKey}`;
    await this.store.saveConversation(chatKey, { kind: 'order', messageId: input.messageId, orderBody, sourceBody,
      customerKey: input.customerKey, customerName: input.name, phone: input.phone || '', items: parsed.items,
      fingerprint: fingerprint(parsed), expiresAt: Date.now() + 15 * 60000 });
    return this.store.saveReply(input, preview(parsed));
  }
  async answerFromData(input, request) {
    const reply = (text) => this.store.saveReply(input, text);
    if (request.intent === 'restricted') return reply('I can help with the shop catalogue and your own WhatsApp orders and balance. Other customer accounts and merchant-only business data are private.');
    if (request.intent === 'product') return reply(productText(await this.store.catalogue(), request.productIds || []));
    if (request.intent === 'balance') return reply(balanceText(await this.store.customerAccount(input), request.language || languageOf(input.body)));
    if (request.intent === 'orders') return reply(ordersText(await this.store.customerAccount(input)));
    if (request.intent === 'payment' && this.payments) return this.payments.choose(input, 'pay', await this.store.conversation(chatKey(input)));
    if (request.intent === 'payment') return reply('I cannot verify or record a payment from a chat message. Please ask the shopkeeper to confirm it.\n\n' + balanceText(await this.store.customerAccount(input), request.language));
    if (['invoice', 'order_status', 'repeat_order'].includes(request.intent)) {
      const invoice = await this.store.customerInvoice(input, request.invoiceRef || 'latest');
      if (request.intent === 'order_status') return reply(statusText(invoice));
      if (request.intent === 'invoice') {
        const result = await reply(invoiceReply(invoice, this.store.shopName));
        return invoice ? { ...result, copyInvoiceId: invoice.id } : result;
      }
      if (!invoice) return reply('No matching order was found for your WhatsApp account. Send MENU to place a new order.');
      return this.previewOrder(input, invoice.items.map((item) => `${item.quantityMilli / 1000} ${item.unit} ${item.productId}`).join(', '), input.body + '\nRepeat of ' + invoice.number);
    }
    return null;
  }
  async process(input) {
    validateIncoming(input);
    const existing = await this.store.message(input.messageId, input.isDemo);
    if (existing) return existing;
    const chatKey = `${input.isDemo ? 'demo' : 'live'}:${input.chatId || input.customerKey}`;
    const command = input.body.trim().toUpperCase();
    let pending = await this.store.conversation(chatKey);
    if (pending && pending.expiresAt < Date.now()) { await this.store.clearConversation(chatKey); pending = null; }
    const reply = (text) => this.store.saveReply(input, text);
    const cancelPending = async () => {
      await this.store.clearConversation(chatKey);
      return reply(pending && pending.expiresAt >= Date.now()
        ? 'Pending order preview discarded. No invoice or khata entry was created for that preview. Existing invoices are unchanged. Send MENU to start again.'
        : 'There is no pending order preview to cancel. Existing invoices and khata entries are unchanged. Contact the shopkeeper to cancel an invoiced order.');
    };
    if (this.payments && (/^(?:PAY(?: NOW)?|UPI|QR|PAYMENT|भुगतान)$/i.test(command) || (['checkout', 'payment'].includes(pending?.kind) && command === '1'))) return this.payments.choose(input, 'pay', pending);
    if (this.payments && (/^(?:KHATA|UDHAAR|PAY LATER|खाता|उधार)$/i.test(command) || (['checkout', 'payment'].includes(pending?.kind) && command === '2'))) return this.payments.choose(input, 'khata', pending);
    if (pending && ['checkout', 'payment'].includes(pending.kind)) {
      if (command === 'CONFIRM') return reply('This order is already invoiced. Reply 1 to pay now or 2 to keep it in khata.');
      pending = null;
    }
    if (command === 'CANCEL') return cancelPending();
    if (command === 'CONFIRM') {
      if (!pending || pending.expiresAt < Date.now()) { await this.store.clearConversation(chatKey); return reply('There is no current order to confirm. Please send your order again or reply MENU.'); }
      if (pending.kind === 'clarify') return reply('Please provide the missing quantities first. I will show the priced order before you confirm.');
      const parsed = parseOrder(pending.orderBody, await this.store.catalogue());
      if (parsed.error) { await this.store.clearConversation(chatKey); return reply('The products changed. Please send MENU and place your order again. No amount was added.'); }
      if (fingerprint(parsed) !== pending.fingerprint) {
        await this.store.saveConversation(chatKey, { ...pending, fingerprint: fingerprint(parsed), expiresAt: Date.now() + 15 * 60000 });
        return reply('The shop prices changed. Please check the new total before confirming.\n\n' + preview(parsed));
      }
      const bookingId = 'confirmed-' + createHash('sha256').update(pending.messageId).digest('hex');
      const result = await this.store.process({ ...input, messageId: bookingId, body: pending.sourceBody,
        orderBody: pending.orderBody, name: pending.customerName, phone: pending.phone, customerKey: pending.customerKey });
      await this.store.saveReply(input, result.reply, result.invoice.id);
      await this.store.clearConversation(chatKey);
      return this.completed(input, result);
    }
    if (chatCommand(input.body)) {
      if (chatCommand(input.body) === 'welcome') await this.store.clearConversation(chatKey);
      return this.store.process(input);
    }
    const catalogue = await this.store.catalogue();
    const request = localRequest(input.body, catalogue);
    if (request) { const result = await this.answerFromData(input, request); if (result) return result; }
    const showCart = () => {
      if (pending?.orderBody) { const parsed = parseOrder(pending.orderBody, catalogue); return reply(parsed.error || preview(parsed)); }
      return reply(pending?.kind === 'clarify' ? `Please give a quantity for: ${catalogue.filter((product) => pending.productIds.includes(product.id)).map((product) => product.name).join(', ')}.\nFor example: 2 kg.`
        : 'There is no pending order. Send MENU or tell me what you want to buy.');
    };
    if (/^(?:CART|SHOW ORDER|MY CART)$/.test(command)) return showCart();
    if (pending?.kind === 'clarify' && pending.productIds.length === 1) {
      const completed = `${input.body} ${pending.productIds[0]}`;
      if (!parseOrder(completed, catalogue).error) return this.previewOrder(input, completed,
        `${pending.sourceBody}\nCustomer quantity: ${input.body}`.slice(-2000));
    }
    // Explicit catalogue-format orders continue to work when AI is unavailable.
    if (!parseOrder(input.body, catalogue).error) {
      if (pending) return this.previewOrder(input, input.body);
      return this.completed(input, await this.store.process(input));
    }
    const context = pending ? { pendingOrder: { kind: pending.kind || 'order', productIds: pending.productIds || [],
      items: (pending.items || parseOrder(pending.orderBody || '', catalogue).items || []).map((item) => ({ productId: item.productId, quantity: item.quantityMilli / 1000, unit: item.unit })) } } : {};
    const answer = await this.ai.interpret(input.body, catalogue, context);
    if (!answer) return this.completed(input, await this.store.process(input));
    const dataReply = await this.answerFromData(input, answer); if (dataReply) return dataReply;
    if (answer.intent === 'menu') return reply(menuText(catalogue, this.store.shopName));
    if (answer.intent === 'cart') return showCart();
    if (answer.intent === 'cancel') return cancelPending();
    if (answer.intent === 'clarify_order') {
      const productIds = answer.productIds?.length ? answer.productIds : matchProducts(input.body, catalogue);
      if (productIds.length) {
        await this.store.saveConversation(chatKey, { kind: 'clarify', productIds, sourceBody: input.body, expiresAt: Date.now() + 15 * 60000 });
        return reply(answer.reply.trim() + '\n\nProducts: ' + catalogue.filter((product) => productIds.includes(product.id)).map((product) => product.name).join(', ') + '\nPlease give the quantities, for example: 2 kg. I will show the full priced order before confirmation.');
      }
    }
    if (!['order', 'update_order'].includes(answer.intent)) return reply(answer.reply.trim() + '\n\nSend MENU for products and prices, BALANCE for your dues, or MY ORDERS for your history.');
    if (answer.intent === 'update_order' && !pending) return reply('There is no pending order to edit. Please send a new order or MENU. Issued invoices are unchanged.');
    const orderBody = answer.items.map((item) => `${item.quantity} ${item.unit} ${item.productId}`).join(', ');
    const sourceBody = pending && (answer.intent === 'update_order' || pending.kind === 'clarify')
      ? `${pending.sourceBody}\nCustomer update: ${input.body}`.slice(-2000) : input.body;
    return this.previewOrder(input, orderBody, sourceBody);
  }
}
