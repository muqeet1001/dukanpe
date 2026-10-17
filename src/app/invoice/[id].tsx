import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Empty, Icon, Page, T, ui } from '../../components/ui';
import { PaymentReview } from '../../components/payment-review';
import { money } from '../../lib/domain';
import { useWhatsApp } from '../../state/whatsapp';
import { colors as c } from '../../theme';

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { snapshot, connection, request, refresh } = useWhatsApp();
  const invoice = snapshot?.invoices.find((item) => item.id === id);
  const payment = snapshot?.payments.find((p) => p.invoiceId === id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed.'); } finally { setBusy(false); } };
  if (!invoice) return <Page title="Order invoice" back><Empty title="Connect to view this invoice" description="Invoices stay on the bot server. Pair the app to load their details." /><Button title="Open WhatsApp orders" onPress={() => router.push('/whatsapp')} /></Page>;
  return <Page title="Order invoice" subtitle={invoice.number} back>
    <Card style={{ gap: 16, backgroundColor: c.navy, borderColor: c.navy }}>
      <View style={ui.between}><Icon name="document-text-outline" color="#8EDCF9" size={27} /><Badge label={invoice.paymentStatus === 'paid' ? 'PAID' : 'UNPAID'} /></View>
      <T weight="extra" style={{ color: c.white, fontSize: 37 }}>{money(invoice.totalPaise)}</T>
      <T weight="bold" style={{ color: c.white, fontSize: 16 }}>{invoice.customerName}</T>
      <T style={{ color: '#C7DEF3', fontSize: 11 }}>{new Date(invoice.createdAt).toLocaleString('en-IN')}</T>
    </Card>
    <Card style={{ gap: 17 }}><T weight="extra" style={{ fontSize: 17 }}>Order details</T>
      {invoice.items.map((item) => <View key={item.productId} style={[ui.between, { gap: 10 }]}><View style={{ flex: 1, gap: 5 }}><T weight="bold" style={{ fontSize: 13 }}>{item.name}</T><T style={{ fontSize: 11, color: c.muted }}>{item.quantityMilli / 1000} {item.unit} × {money(item.unitPricePaise)}</T></View><T weight="bold" style={{ fontSize: 14 }}>{money(item.totalPaise)}</T></View>)}
      <View style={{ height: 1, backgroundColor: c.line }} /><View style={ui.between}><T weight="bold">Total</T><T weight="extra" style={{ fontSize: 21 }}>{money(invoice.totalPaise)}</T></View>
      <T style={ui.help}>{invoice.paymentStatus === 'paid' ? 'Paid. Receipt confirmed by merchant; khata updated.' : 'Added to khata as unpaid credit. No confirmed payment yet.'} No tax calculated.</T>
    </Card>
    {payment && <PaymentReview payment={payment} />}
    <Card style={{ gap: 10, backgroundColor: c.sky }}><T style={{ color: c.muted, fontSize: 11 }}>WhatsApp orders balance at issue</T><T weight="extra" style={{ fontSize: 27 }}>{money(invoice.balanceAfterPaise)}</T><T style={ui.help}>This balance covers orders recorded by the bot. Open customer khata for local entries as well.</T><Button title="Open customer khata" secondary onPress={() => router.push({ pathname: '/customer/[id]', params: { id: invoice.customerId } })} /></Card>
    <Card style={{ gap: 10 }}><T weight="bold" style={{ fontSize: 13 }}>Original customer message</T><T selectable style={{ fontSize: 13, lineHeight: 22 }}>{invoice.sourceBody}</T>
      <T style={ui.help}>{invoice.isDemo ? 'Simulated chat. No messages sent.' : `WhatsApp invoice delivery: ${invoice.delivery}`}</T>
      {invoice.deliveryError && <T style={{ color: c.amber, fontSize: 11, lineHeight: 20 }}>{invoice.deliveryError}</T>}
    </Card>
    {!!error && <T accessibilityLiveRegion="polite" style={{ color: c.amber, fontSize: 12 }}>{error}</T>}
    <Button title="View invoice PDF" icon="document-outline" disabled={busy} onPress={() => void run(async () => {
      const response = await request<{ path: string }>('/api/invoices/' + invoice.id + '/pdf-link');
      if (!response.path.startsWith('/download/invoice/')) throw new Error('Invalid invoice link.');
      await Linking.openURL(connection!.url + response.path);
    })} />
    {!invoice.isDemo && ['pending', 'uncertain'].includes(invoice.delivery) && <>
      <T style={ui.help}>Check the customer chat before resending. This sends the same invoice and does not add another khata debit.</T>
      <Button title="Resend same invoice to customer" secondary disabled={busy} onPress={() => void run(async () => { await request('/api/invoices/' + invoice.id + '/resend', { method: 'POST' }); await refresh(); })} />
    </>}
  </Page>;
}
