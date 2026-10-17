import { MongoClient } from 'mongodb';
import { createHash, randomUUID } from 'node:crypto';
import { chatCommand, invoiceText, menuText, orderHelpText, parseOrder, validateCatalogue, validateIncoming, welcomeText } from './orders.js';
import { snapshotData } from './snapshot.js';
import { identityKeys } from './customer-data.js';

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const publicDocument = ({ _id, ...document }) => ({ id: _id, ...document });

export class MongoStore {
  static async connect(uri, databaseName, catalogue, shopName, { prefix = 'dukanpe_' } = {}) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000, maxPoolSize: 5 });
    try {
      await client.connect();
      const store = new MongoStore(client, client.db(databaseName), shopName, prefix);
      await store.initialise(catalogue);
      return store;
    } catch (error) { await client.close(); throw error; }
  }
  constructor(client, db, shopName, prefix) {
    this.client = client; this.db = db; this.shopName = shopName;
    this.collections = Object.fromEntries(['products', 'customers', 'messages', 'invoices', 'ledger', 'outbox', 'conversations', 'payments', 'payment_proofs']
      .map((name) => [name, db.collection(prefix + name)]));
  }
  async initialise(catalogue) {
    const c = this.collections;
    await Promise.all([
      c.customers.createIndex({ identity: 1 }, { unique: true }),
      c.invoices.createIndex({ number: 1 }, { unique: true }),
      c.invoices.createIndex({ sourceMessageId: 1 }, { unique: true }),
      c.invoices.createIndex({ customerId: 1, createdAt: -1 }),
      c.ledger.createIndex({ invoiceId: 1 }, { unique: true }),
      c.outbox.createIndex({ status: 1 }),
      c.outbox.createIndex({ destination: 1 }),
      c.conversations.createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 }),
      c.payments.createIndex({ confirmedReference: 1 }, { unique: true, sparse: true }),
      c.payment_proofs.createIndex({ invoiceId: 1 }),
    ]);
    await c.products.bulkWrite(validateCatalogue(catalogue).map(({ id, ...product }, position) => ({
      updateOne: { filter: { _id: id }, update: { $setOnInsert: { ...product, position } }, upsert: true },
    })));
    await c.outbox.updateMany({ status: 'sending' }, { $set: { status: 'uncertain', error: 'Server restarted during delivery. Check the WhatsApp chat before resending.' } });
  }
  async close() { await this.client.close(); }
  async catalogue() { return (await this.collections.products.find().sort({ position: 1 }).toArray()).map(({ position, ...product }) => publicDocument(product)); }
  async setPrice(id, pricePaise) {
    if (!Number.isSafeInteger(pricePaise) || pricePaise < 1 || pricePaise > 10000000) throw new Error('Enter a valid price between INR 0.01 and INR 1,00,000.');
    if (!(await this.collections.products.updateOne({ _id: id }, { $set: { pricePaise } })).matchedCount) throw new Error('Product not found.');
  }
  async balance(customerId) { return (await this.collections.customers.findOne({ _id: customerId }))?.balancePaise ?? 0; }
  async customerScope(input) {
    const c = this.collections; const mode = input.isDemo ? 'demo' : 'live';
    const destination = input.chatId || input.customerKey;
    const jobs = await c.outbox.find({ destination }, { projection: { _id: 1 } }).toArray();
    const previous = jobs.length ? await c.invoices.find({ _id: { $in: jobs.map((job) => job._id) }, isDemo: Boolean(input.isDemo) }, { projection: { customerId: 1 } }).toArray() : [];
    return c.customers.find({ mode, $or: [{ identity: { $in: identityKeys(input) } }, { _id: { $in: previous.map((row) => row.customerId) } }] }).toArray();
  }
  async customerAccount(input) {
    const customers = await this.customerScope(input); const ids = customers.map((customer) => customer._id);
    if (!ids.length) return { found: false, balancePaise: 0, orderCount: 0, orders: [] };
    const filter = { customerId: { $in: ids } };
    const [rows, orderCount] = await Promise.all([
      this.collections.invoices.find(filter).sort({ createdAt: -1, _id: -1 }).limit(5).toArray(), this.collections.invoices.countDocuments(filter),
    ]);
    return { found: true, balancePaise: customers.reduce((sum, customer) => sum + customer.balancePaise, 0), orderCount,
      orders: await Promise.all(rows.map((row) => this.invoice(row._id))) };
  }
  async customerInvoice(input, reference = 'latest') {
    const ids = (await this.customerScope(input)).map((customer) => customer._id); if (!ids.length) return null;
    const filter = { customerId: { $in: ids }, ...(reference === 'latest' ? {} : { $or: [{ _id: reference }, { number: reference.toUpperCase() }] }) };
    const row = await this.collections.invoices.find(filter).sort({ createdAt: -1, _id: -1 }).limit(1).next();
    return row ? this.invoice(row._id) : null;
  }
  async invoice(id) {
    const row = await this.collections.invoices.findOne({ _id: id });
    if (!row) return null;
    const [customer, outbox, payment] = await Promise.all([
      this.collections.customers.findOne({ _id: row.customerId }), this.collections.outbox.findOne({ _id: id }), this.payment(id),
    ]);
    return { ...publicDocument(row), customerName: customer.name, customerPhone: customer.phone,
      delivery: outbox.status, deliveryError: outbox.error, destination: outbox.destination, paymentStatus: payment?.status === 'confirmed' ? 'paid' : 'unpaid', paymentReview: payment?.status || null };
  }
  async payment(id) { const row = await this.collections.payments.findOne({ _id: id }); return row ? publicDocument(row) : null; }
  async saveProof(proof) {
    const c = this.collections; const session = this.client.startSession(); let result;
    try {
      await session.withTransaction(async () => {
        const current = await c.payments.findOne({ _id: proof.invoiceId }, { session });
        const previous = await c.payment_proofs.findOne({ _id: proof.proofId }, { session });
        if (previous && previous.invoiceId !== proof.invoiceId) { result = { status: 'reused' }; return; }
        if (current?.status === 'confirmed' || current?.proofId === proof.proofId) { result = publicDocument(current); return; }
        const invoice = await c.invoices.findOne({ _id: proof.invoiceId, isDemo: false }, { session });
        if (!invoice) throw new Error('Payment invoice not found.');
        result = { ...proof, amountPaise: invoice.totalPaise, customerId: invoice.customerId, status: 'review' };
        await c.payment_proofs.updateOne({ _id: proof.proofId }, { $setOnInsert: { invoiceId: proof.invoiceId } }, { upsert: true, session });
        await c.payments.replaceOne({ _id: proof.invoiceId }, { _id: proof.invoiceId, ...result }, { upsert: true, session });
      });
      return result;
    } catch (error) {
      if (error.code === 11000) {
        const previous = await c.payment_proofs.findOne({ _id: proof.proofId });
        if (previous?.invoiceId !== proof.invoiceId) return { status: 'reused' };
        const payment = await this.payment(proof.invoiceId); if (payment) return payment;
      }
      throw error;
    } finally { await session.endSession(); }
  }
  async reviewPayment(id, proofId, decision) {
    const c = this.collections; const session = this.client.startSession(); let result;
    try {
      await session.withTransaction(async () => {
        const payment = await c.payments.findOne({ _id: id }, { session });
        if (!payment || payment.proofId !== proofId) throw new Error('Payment proof changed. Refresh and review again.');
        if (payment.status === 'confirmed') { result = publicDocument(payment); return; }
        if (payment.status !== 'review' || !['confirmed', 'rejected'].includes(decision)) throw new Error('Payment is not awaiting review.');
        const reviewedAt = new Date().toISOString();
        const confirmedReference = decision === 'confirmed' ? payment.checks.reference : '';
        if (confirmedReference && await c.payments.findOne({ confirmedReference }, { session })) throw new Error('Payment reference already used for another invoice.');
        await c.payments.updateOne({ _id: id }, { $set: { status: decision, reviewedAt, verifiedBy: 'merchant', ...(confirmedReference ? { confirmedReference } : {}) } }, { session });
        if (decision === 'confirmed') await c.customers.updateOne({ _id: payment.customerId }, { $inc: { balancePaise: -payment.amountPaise } }, { session });
        result = { ...publicDocument(payment), status: decision, reviewedAt, verifiedBy: 'merchant' };
      });
      return result;
    } catch (error) { if (error.code === 11000) throw new Error('Payment reference already used for another invoice.'); throw error; }
    finally { await session.endSession(); }
  }
  async message(messageId, isDemo = false) {
    const row = await this.collections.messages.findOne({ _id: `${isDemo ? 'demo' : 'live'}:${messageId}` });
    return row ? { reply: row.reply, invoice: row.invoiceId ? await this.invoice(row.invoiceId) : null, duplicate: true } : null;
  }
  async saveReply(input, reply, invoiceId = null) {
    validateIncoming(input);
    const existing = await this.message(input.messageId, input.isDemo); if (existing) return existing;
    try {
      await this.collections.messages.insertOne({ _id: `${input.isDemo ? 'demo' : 'live'}:${input.messageId}`, body: input.body, reply, invoiceId, createdAt: new Date().toISOString() });
      return { reply, invoice: invoiceId ? await this.invoice(invoiceId) : null, duplicate: false };
    } catch (error) { if (error.code === 11000) return this.message(input.messageId, input.isDemo); throw error; }
  }
  async conversation(key) { return this.collections.conversations.findOne({ _id: key }); }
  async saveConversation(key, data) {
    const { _id, expiresAtDate, ...value } = data;
    await this.collections.conversations.replaceOne({ _id: key }, { _id: key, ...value, expiresAtDate: new Date(value.expiresAt) }, { upsert: true });
  }
  async clearConversation(key) { await this.collections.conversations.deleteOne({ _id: key }); }
  async process({ messageId, customerKey, chatId = customerKey, name, phone = '', body, orderBody, isDemo = false }) {
    validateIncoming({ messageId, customerKey, chatId, name, phone, body, orderBody });
    const c = this.collections; const mode = isDemo ? 'demo' : 'live'; const key = `${mode}:${messageId}`;
    const duplicate = async () => {
      const existing = await c.messages.findOne({ _id: key });
      return existing ? { reply: existing.reply, invoice: existing.invoiceId ? await this.invoice(existing.invoiceId) : null, duplicate: true } : null;
    };
    const existing = await duplicate(); if (existing) return existing;
    const catalogue = await this.catalogue(); const command = chatCommand(body);
    const parsed = command ? null : parseOrder(orderBody ?? body, catalogue);
    if (command || parsed.error) {
      const reply = command === 'welcome' ? welcomeText(this.shopName) : command === 'menu' ? menuText(catalogue, this.shopName)
        : command === 'order' ? orderHelpText() : `${parsed.error}\n\nNo invoice created and no amount added. Send HI to get started or MENU to see prices.`;
      try { await c.messages.insertOne({ _id: key, body, reply, invoiceId: null, createdAt: new Date().toISOString() }); }
      catch (error) { if (error.code === 11000) return await duplicate(); throw error; }
      return { reply, invoice: null, duplicate: false };
    }
    const id = randomUUID(); const createdAt = new Date().toISOString();
    const number = `DK-${createdAt.slice(0, 10).replaceAll('-', '')}-${id.slice(0, 8).toUpperCase()}`;
    const identity = `${mode}:${customerKey}`; const customerId = 'wa-customer-' + hash(identity);
    const session = this.client.startSession();
    let reply;
    try {
      await session.withTransaction(async () => {
        // The customer increment serialises concurrent orders for the same account.
        const customer = await c.customers.findOneAndUpdate({ _id: customerId }, {
          $setOnInsert: { identity, name: name.trim() || 'WhatsApp customer', phone, mode },
          $inc: { balancePaise: parsed.totalPaise },
        }, { upsert: true, returnDocument: 'after', session });
        const invoice = { _id: id, number, customerId, createdAt, items: parsed.items, totalPaise: parsed.totalPaise,
          balanceAfterPaise: customer.balancePaise, sourceMessageId: key, sourceBody: body, isDemo };
        reply = invoiceText({ ...publicDocument(invoice), customerName: customer.name }, this.shopName);
        await c.invoices.insertOne(invoice, { session });
        await c.ledger.insertOne({ _id: 'wa-sale-' + id, invoiceId: id, customerId, amountPaise: parsed.totalPaise, createdAt }, { session });
        await c.outbox.insertOne({ _id: id, destination: chatId, status: isDemo ? 'demo' : 'pending', messageId: null, error: null }, { session });
        await c.messages.insertOne({ _id: key, body, reply, invoiceId: id, createdAt }, { session });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (error) {
      if (error.code === 11000) { const repeated = await duplicate(); if (repeated) return repeated; }
      throw error;
    } finally { await session.endSession(); }
    return { reply, invoice: await this.invoice(id), duplicate: false };
  }
  async delivery(id, status, error = null, messageId = null) { await this.collections.outbox.updateOne({ _id: id }, { $set: { status, error, messageId } }); }
  async pending() { return (await this.collections.outbox.find({ status: 'pending' }, { projection: { _id: 1 } }).toArray()).map((row) => row._id); }
  async snapshot({ liveOnly = false } = {}) {
    const rows = await this.collections.invoices.find(liveOnly ? { isDemo: false } : {}).sort({ createdAt: -1, _id: -1 }).toArray();
    const customers = await this.collections.customers.find(liveOnly ? { mode: 'live' } : {}).toArray();
    const invoices = await Promise.all(rows.map((row) => this.invoice(row._id)));
    const payments = (await this.collections.payments.find().toArray()).map(publicDocument).filter((p) => invoices.some((i) => i.id === p.invoiceId));
    return snapshotData(this.shopName, await this.catalogue(), invoices, customers.map(publicDocument), payments);
  }
}
