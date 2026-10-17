import PDFDocument from 'pdfkit';
import { money } from './orders.js';

// ASCII currency and a phone fallback keep built-in PDF fonts reliable without OS fonts.
const printable = (value, fallback = 'WhatsApp customer') => /^[\x20-\x7E]+$/.test(value) ? value : fallback;
export function invoicePdf(invoice, shopName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 45, info: { Title: `Order invoice ${invoice.number}`, Author: 'Dukanpe' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.rect(0, 0, 595.28, 145).fill('#002970');
    doc.font('Helvetica-Bold').fontSize(25).fillColor('white').text(printable(shopName, 'Dukanpe Shop'), 45, 42, { width: 440 });
    doc.font('Helvetica').fontSize(10).fillColor('#9BDEFA').text('ORDER INVOICE  /  UNPAID', 45, 83);
    doc.fontSize(10).text(invoice.number, 45, 107);
    doc.fillColor('#002970').font('Helvetica-Bold').fontSize(13).text('Bill to', 45, 174);
    doc.font('Helvetica').fontSize(11).fillColor('#263C53').text(printable(invoice.customerName, invoice.customerPhone || 'WhatsApp customer'), 45, 197, { width: 300, height: 30, ellipsis: true });
    if (invoice.customerPhone) doc.fontSize(10).text(invoice.customerPhone, 45, 231);
    doc.fontSize(10).text(new Date(invoice.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }), 360, 177, { width: 190, align: 'right' });
    doc.roundedRect(45, 250, 505, 31, 5).fill('#E4F4FC');
    const headings = [['Item', 55, 190, 'left'], ['Qty', 245, 65, 'right'], ['Unit price', 315, 105, 'right'], ['Amount', 425, 115, 'right']];
    for (const [text, x, width, align] of headings) doc.font('Helvetica-Bold').fontSize(10).fillColor('#002970').text(text, x, 260, { width, align });
    let y = 296;
    for (const item of invoice.items) {
      doc.font('Helvetica').fontSize(10);
      const label = printable(item.name, item.productId);
      const rowHeight = Math.max(39, doc.heightOfString(label, { width: 185 }) + 20);
      if (y + rowHeight > 600) { doc.addPage(); y = 70; }
      doc.fillColor('#263C53').text(label, 55, y, { width: 185 });
      doc.text(`${item.quantityMilli / 1000} ${item.unit}`, 245, y, { width: 65, align: 'right' });
      doc.text(money(item.unitPricePaise), 315, y, { width: 105, align: 'right' });
      doc.text(money(item.totalPaise), 425, y, { width: 115, align: 'right' });
      doc.moveTo(45, y + rowHeight - 14).lineTo(550, y + rowHeight - 14).lineWidth(0.5).strokeColor('#E7EDF4').stroke();
      y += rowHeight;
    }
    y += 16;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#002970').text('Invoice total', 55, y).text(money(invoice.totalPaise), 355, y, { width: 185, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#526A83').text('Added to customer khata as unpaid credit.', 55, y + 29);
    doc.text('WhatsApp-order balance after this invoice: ' + money(invoice.balanceAfterPaise), 55, y + 49);
    doc.fontSize(9).fillColor('#75899D').text('No payment recorded. No tax calculated. This is an order invoice.', 45, 728, { width: 505 });
    doc.text(invoice.isDemo ? 'SIMULATED ORDER - no WhatsApp message was sent.' : 'Generated from an incoming WhatsApp order.', 45, 745, { width: 505 });
    doc.end();
  });
}
