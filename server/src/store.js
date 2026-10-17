import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { invoiceText, menuText, parseOrder, validateCatalogue } from './orders.js';

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
export class Store {
  constructor(filename, catalogue, shopName) {
    this.shopName = shopName;
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL, price_paise INTEGER NOT NULL CHECK(price_paise>0), aliases_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT NOT NULL, mode TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, body TEXT NOT NULL, reply TEXT NOT NULL, invoice_id TEXT);
      CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL REFERENCES customers(id), created_at TEXT NOT NULL,
        items_json TEXT NOT NULL, total_paise INTEGER NOT NULL CHECK(total_paise>0), balance_after_paise INTEGER NOT NULL,
        source_message_id TEXT NOT NULL UNIQUE, source_body TEXT NOT NULL, mode TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id), customer_id TEXT NOT NULL REFERENCES customers(id), amount_paise INTEGER NOT NULL CHECK(amount_paise>0));
      CREATE TABLE IF NOT EXISTS outbox(invoice_id TEXT PRIMARY KEY REFERENCES invoices(id), destination TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT, error TEXT);
    `);
    const insert = this.db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?,?,?)');
    for (const product of validateCatalogue(catalogue)) insert.run(product.id, product.name, product.unit, product.pricePaise, JSON.stringify(product.aliases));
    // A crash during send can leave delivery ambiguous. Do not silently send twice.
    this.db.prepare("UPDATE outbox SET status='uncertain',error='Server restarted during delivery. Check the WhatsApp chat before resending.' WHERE status='sending'").run();
  }
  close() { this.db.close(); }
  catalogue() { return this.db.prepare('SELECT * FROM products ORDER BY rowid').all().map((p) => ({ id: p.id, name: p.name, unit: p.unit, pricePaise: p.price_paise, aliases: JSON.parse(p.aliases_json) })); }
  setPrice(id, pricePaise) {
    if (!Number.isSafeInteger(pricePaise) || pricePaise < 1 || pricePaise > 10000000) throw new Error('Enter a valid price between INR 0.01 and INR 1,00,000.');
    if (!this.db.prepare('UPDATE products SET price_paise=? WHERE id=?').run(pricePaise, id).changes) throw new Error('Product not found.');
  }
  balance(customerId) { return this.db.prepare('SELECT COALESCE(SUM(amount_paise),0) AS balance FROM ledger WHERE customer_id=?').get(customerId).balance; }
  invoice(id) {
    const row = this.db.prepare(`SELECT i.*, c.name,c.phone,c.identity,o.status AS delivery,o.error AS delivery_error,o.destination
      FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN outbox o ON o.invoice_id=i.id WHERE i.id=?`).get(id);
    if (!row) return null;
    return { id: row.id, number: row.number, customerId: row.customer_id, customerName: row.name, customerPhone: row.phone,
      createdAt: row.created_at, items: JSON.parse(row.items_json), totalPaise: row.total_paise, balanceAfterPaise: row.balance_after_paise,
      sourceMessageId: row.source_message_id, sourceBody: row.source_body, isDemo: row.mode === 'demo', delivery: row.delivery,
      deliveryError: row.delivery_error, destination: row.destination, paymentStatus: 'unpaid' };
  }
  process({ messageId, customerKey, chatId = customerKey, name, phone = '', body, isDemo = false }) {
    if (typeof messageId !== 'string' || !messageId || messageId.length > 240 || typeof customerKey !== 'string' || !customerKey || customerKey.length > 160
      || typeof body !== 'string' || body.length > 2000 || typeof name !== 'string' || name.length > 100 || typeof phone !== 'string' || phone.length > 30) throw new Error('Invalid order message.');
    const mode = isDemo ? 'demo' : 'live';
    const key = `${mode}:${messageId}`;
    const existing = this.db.prepare('SELECT * FROM messages WHERE id=?').get(key);
    if (existing) return { reply: existing.reply, invoice: existing.invoice_id ? this.invoice(existing.invoice_id) : null, duplicate: true };
    const catalogue = this.catalogue();
    const isMenu = /^(?:\/?menu|\/?help|hi|hello|start)$/i.test(body.trim());
    const parsed = isMenu ? null : parseOrder(body, catalogue);
    if (isMenu || parsed.error) {
      const reply = isMenu ? menuText(catalogue, this.shopName) : `${parsed.error}\n\nNo invoice created and no amount added. Send MENU to see prices.`;
      this.db.prepare('INSERT INTO messages VALUES(?,?,?,NULL)').run(key, body, reply);
      return { reply, invoice: null, duplicate: false };
    }
    const identity = `${mode}:${customerKey}`;
    const customerId = 'wa-customer-' + hash(identity);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const number = `DK-${createdAt.slice(0, 10).replaceAll('-', '')}-${id.slice(0, 8).toUpperCase()}`;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR IGNORE INTO customers VALUES(?,?,?,?,?)').run(customerId, identity, name.trim() || 'WhatsApp customer', phone, mode);
      const balance = this.balance(customerId) + parsed.totalPaise;
      this.db.prepare('INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, number, customerId, createdAt, JSON.stringify(parsed.items), parsed.totalPaise, balance, key, body, mode);
      this.db.prepare('INSERT INTO ledger VALUES(?,?,?,?)').run('wa-sale-' + id, id, customerId, parsed.totalPaise);
      this.db.prepare('INSERT INTO outbox VALUES(?,?,?,NULL,NULL)').run(id, chatId, isDemo ? 'demo' : 'pending');
      const invoice = this.invoice(id);
      const reply = invoiceText(invoice, this.shopName);
      this.db.prepare('INSERT INTO messages VALUES(?,?,?,?)').run(key, body, reply, id);
      this.db.exec('COMMIT');
      return { reply, invoice, duplicate: false };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  delivery(id, status, error = null, messageId = null) { this.db.prepare('UPDATE outbox SET status=?,error=?,message_id=? WHERE invoice_id=?').run(status, error, messageId, id); }
  pending() { return this.db.prepare("SELECT invoice_id FROM outbox WHERE status='pending'").all().map((row) => row.invoice_id); }
  snapshot() {
    const invoices = this.db.prepare('SELECT id FROM invoices ORDER BY created_at DESC,rowid DESC').all().map((row) => this.invoice(row.id));
    const parties = this.db.prepare('SELECT * FROM customers ORDER BY rowid').all().map((row) => ({ id: row.id, name: row.name,
      initials: row.name.split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase(), color: 'mint', openingBalancePaise: 0,
      phone: row.phone, origin: 'whatsapp-bot', note: `${row.mode === 'demo' ? 'Simulated WhatsApp order' : 'WhatsApp orders'}${row.phone ? ' · ' + row.phone : ''}` }));
    const records = invoices.flatMap((invoice) => {
      const base = { source: 'WhatsApp', partyId: invoice.customerId, createdAt: invoice.createdAt, origin: 'whatsapp-bot', isDemo: invoice.isDemo, invoiceId: invoice.id };
      return [
        { ...base, id: 'wa-sale-' + invoice.id, kind: 'sale', status: 'confirmed', amountPaise: invoice.totalPaise,
          title: `${invoice.customerName} · Credit order`, subtitle: `${invoice.number} · Unpaid`, evidence: `Invoice ${invoice.number}. ${invoice.items.map((item) => `${item.quantityMilli / 1000} ${item.unit} ${item.name}`).join(', ')}. Automatically added to khata once.`, note: 'An unpaid order invoice. No receipt or payment has been recorded.' },
        { ...base, id: 'wa-invoice-' + invoice.id, kind: 'invoice', status: 'saved', amountPaise: invoice.totalPaise,
          title: `Invoice ${invoice.number}`, subtitle: `${invoice.customerName} · Unpaid invoice`, evidence: invoiceText(invoice, this.shopName) },
        { ...base, id: 'wa-message-' + invoice.id, kind: 'message', status: 'saved', title: `${invoice.customerName} · WhatsApp order`,
          subtitle: `${invoice.isDemo ? 'Simulated' : 'Received'} · ${invoice.number}`, evidence: invoice.sourceBody },
      ];
    });
    return { shopName: this.shopName, catalogue: this.catalogue(), invoices: invoices.map(({ destination, ...invoice }) => invoice), parties, records };
  }
}
