import { chatCommand, menuText, money, parseOrder, validateIncoming } from './orders.js';
import { createHash } from 'node:crypto';

const fingerprint = (parsed) => JSON.stringify(parsed.items.map(({ productId, quantityMilli, unit, unitPricePaise, totalPaise }) => ({ productId, quantityMilli, unit, unitPricePaise, totalPaise })));
const preview = (parsed) => `Please check your order:\n\n${parsed.items.map((item) => `${item.quantityMilli / 1000} ${item.unit} ${item.name} · ${money(item.totalPaise)}`).join('\n')}\n\nTotal: ${money(parsed.totalPaise)}\n\nReply CONFIRM to receive your invoice and add this unpaid total to khata. Reply CANCEL to discard.\nNothing has been added yet.`;

export class WhatsAppAssistant {
  constructor(store, ai) { this.store = store; this.ai = ai; }
  async process(input) {
    validateIncoming(input);
    const existing = await this.store.message(input.messageId, input.isDemo);
    if (existing) return existing;
    const chatKey = `${input.isDemo ? 'demo' : 'live'}:${input.chatId || input.customerKey}`;
    const command = input.body.trim().toUpperCase();
    const pending = await this.store.conversation(chatKey);
    const reply = (text) => this.store.saveReply(input, text);
    if (command === 'CANCEL') {
      await this.store.clearConversation(chatKey);
      return reply(pending && pending.expiresAt >= Date.now()
        ? 'Pending order preview discarded. No invoice or khata entry was created for that preview. Existing invoices are unchanged. Send MENU to start again.'
        : 'There is no pending order preview to cancel. Existing invoices and khata entries are unchanged. Contact the shopkeeper to cancel an invoiced order.');
    }
    if (command === 'CONFIRM') {
      if (!pending || pending.expiresAt < Date.now()) { await this.store.clearConversation(chatKey); return reply('There is no current order to confirm. Please send your order again or reply MENU.'); }
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
      return result;
    }
    if (chatCommand(input.body)) {
      if (chatCommand(input.body) === 'welcome') await this.store.clearConversation(chatKey);
      return this.store.process(input);
    }
    const catalogue = await this.store.catalogue();
    // Explicit catalogue-format orders continue to work when AI is unavailable.
    if (!parseOrder(input.body, catalogue).error) { await this.store.clearConversation(chatKey); return this.store.process(input); }
    const answer = await this.ai.interpret(input.body, catalogue);
    if (!answer) return this.store.process(input);
    if (answer.intent === 'menu') return reply(menuText(catalogue, this.store.shopName));
    if (answer.intent !== 'order') return reply(answer.reply.trim() + '\n\nSend MENU for products and prices.');
    const orderBody = answer.items.map((item) => `${item.quantity} ${item.unit} ${item.productId}`).join(', ');
    const parsed = parseOrder(orderBody, catalogue);
    if (parsed.error) return reply(parsed.error + '\n\nSend MENU to see prices. Nothing has been added to khata.');
    await this.store.saveConversation(chatKey, { messageId: input.messageId, orderBody, sourceBody: input.body, customerKey: input.customerKey,
      customerName: input.name, phone: input.phone || '', fingerprint: fingerprint(parsed), expiresAt: Date.now() + 15 * 60000 });
    return reply(preview(parsed));
  }
}
