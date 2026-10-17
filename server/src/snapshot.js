import { invoiceText } from './orders.js';

export function snapshotData(shopName, catalogue, invoices, customers, payments = []) {
  const parties = customers.map((row) => ({ id: row.id, name: row.name,
    initials: row.name.split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase(), color: 'mint', openingBalancePaise: 0,
    phone: row.phone, origin: 'whatsapp-bot', note: `${row.mode === 'demo' ? 'Simulated WhatsApp order' : 'WhatsApp orders'}${row.phone ? ' · ' + row.phone : ''}` }));
  const records = invoices.flatMap((invoice) => {
    const base = { source: 'WhatsApp', partyId: invoice.customerId, createdAt: invoice.createdAt, origin: 'whatsapp-bot', isDemo: invoice.isDemo, invoiceId: invoice.id };
    return [
      { ...base, id: 'wa-sale-' + invoice.id, kind: 'sale', status: 'confirmed', amountPaise: invoice.totalPaise,
        title: `${invoice.customerName} · Order`, subtitle: `${invoice.number} · ${invoice.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}`, evidence: `Invoice ${invoice.number}. ${invoice.items.map((item) => `${item.quantityMilli / 1000} ${item.unit} ${item.name}`).join(', ')}. Automatically added to khata once.`, note: invoice.paymentStatus === 'paid' ? 'Settled by a merchant-confirmed receipt.' : 'Unpaid until a receipt is confirmed.' },
      { ...base, id: 'wa-invoice-' + invoice.id, kind: 'invoice', status: 'saved', amountPaise: invoice.totalPaise,
        title: `Invoice ${invoice.number}`, subtitle: `${invoice.customerName} · ${invoice.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'} invoice`, evidence: invoiceText(invoice, shopName) },
      { ...base, id: 'wa-message-' + invoice.id, kind: 'message', status: 'saved', title: `${invoice.customerName} · WhatsApp order`,
        subtitle: `${invoice.isDemo ? 'Simulated' : 'Received'} · ${invoice.number}`, evidence: invoice.sourceBody },
    ];
  });
  for (const payment of payments) {
    const invoice = invoices.find((i) => i.id === payment.invoiceId); if (!invoice || payment.status === 'rejected') continue;
    records.push({ id: 'wa-receipt-' + invoice.id, kind: 'receipt', source: 'WhatsApp', partyId: invoice.customerId,
      amountPaise: payment.amountPaise, status: payment.status === 'confirmed' ? 'confirmed' : 'review',
      createdAt: payment.reviewedAt || payment.submittedAt, origin: 'whatsapp-bot', invoiceId: invoice.id, isDemo: false,
      linkedSaleId: 'wa-sale-' + invoice.id, title: `${invoice.customerName} · UPI payment`,
      subtitle: payment.status === 'confirmed' ? 'Merchant confirmed · UPI' : 'Screenshot · Awaiting verification',
      evidence: `Invoice ${invoice.number}. Expected ${payment.amountPaise / 100} INR to ${payment.upiId}. Reference: ${payment.checks.reference || 'Not readable'}. ${payment.checks.warnings.join(' ')}`,
      note: payment.status === 'confirmed' ? 'Merchant confirmed receipt in their account. Not automatically bank verified.' : 'A screenshot is evidence only. Verify receipt in your payment or bank app before confirming.' });
  }
  return { shopName, catalogue, invoices: invoices.map(({ destination, ...invoice }) => invoice), parties, records, payments };
}
