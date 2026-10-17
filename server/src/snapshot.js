import { invoiceText } from './orders.js';

export function snapshotData(shopName, catalogue, invoices, customers) {
  const parties = customers.map((row) => ({ id: row.id, name: row.name,
    initials: row.name.split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase(), color: 'mint', openingBalancePaise: 0,
    phone: row.phone, origin: 'whatsapp-bot', note: `${row.mode === 'demo' ? 'Simulated WhatsApp order' : 'WhatsApp orders'}${row.phone ? ' · ' + row.phone : ''}` }));
  const records = invoices.flatMap((invoice) => {
    const base = { source: 'WhatsApp', partyId: invoice.customerId, createdAt: invoice.createdAt, origin: 'whatsapp-bot', isDemo: invoice.isDemo, invoiceId: invoice.id };
    return [
      { ...base, id: 'wa-sale-' + invoice.id, kind: 'sale', status: 'confirmed', amountPaise: invoice.totalPaise,
        title: `${invoice.customerName} · Credit order`, subtitle: `${invoice.number} · Unpaid`, evidence: `Invoice ${invoice.number}. ${invoice.items.map((item) => `${item.quantityMilli / 1000} ${item.unit} ${item.name}`).join(', ')}. Automatically added to khata once.`, note: 'An unpaid order invoice. No receipt or payment has been recorded.' },
      { ...base, id: 'wa-invoice-' + invoice.id, kind: 'invoice', status: 'saved', amountPaise: invoice.totalPaise,
        title: `Invoice ${invoice.number}`, subtitle: `${invoice.customerName} · Unpaid invoice`, evidence: invoiceText(invoice, shopName) },
      { ...base, id: 'wa-message-' + invoice.id, kind: 'message', status: 'saved', title: `${invoice.customerName} · WhatsApp order`,
        subtitle: `${invoice.isDemo ? 'Simulated' : 'Received'} · ${invoice.number}`, evidence: invoice.sourceBody },
    ];
  });
  return { shopName, catalogue, invoices: invoices.map(({ destination, ...invoice }) => invoice), parties, records };
}
