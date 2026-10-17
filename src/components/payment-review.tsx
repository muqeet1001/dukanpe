import * as Linking from 'expo-linking';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { BotPayment } from '../lib/bot-api';
import { money } from '../lib/domain';
import { useWhatsApp } from '../state/whatsapp';
import { colors as c } from '../theme';
import { Badge, Button, Card, Icon, T, ui } from './ui';

export function PaymentReview({ payment }: { payment: BotPayment }) {
  const { request, refresh, connection } = useWhatsApp();
  const [received, setReceived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Payment review failed.'); }
    finally { setBusy(false); }
  };
  const review = (decision: 'confirmed' | 'rejected') => void run(async () => {
    await request('/api/payments/' + payment.invoiceId + '/review', { method: 'POST', body: { proofId: payment.proofId, decision, receivedInAccount: received } });
    setReceived(false); await refresh();
  });
  return <Card style={{ gap: 15, borderColor: payment.status === 'review' ? '#F4CD86' : c.line }}>
    <View style={ui.between}><T weight="extra" style={{ fontSize: 17 }}>Payment evidence</T><Badge label={payment.status === 'review' ? 'Review' : payment.status === 'confirmed' ? 'Received' : 'Rejected'} tone={payment.status === 'confirmed' ? 'green' : 'amber'} /></View>
    <T weight="extra" style={{ fontSize: 28 }}>{money(payment.amountPaise)}</T>
    <T selectable style={ui.help}>Payee: {payment.upiId}{'\n'}UPI reference: {payment.checks.reference || 'Not readable'}</T>
    {[{ label: 'Invoice amount', matched: payment.checks.amountMatched }, { label: 'Merchant UPI ID', matched: payment.checks.payeeMatched }, { label: 'Success text', matched: payment.checks.successful }].map((check) => <View key={check.label} style={ui.between}>
      <T style={{ fontSize: 12 }}>{check.label}</T><T weight="bold" style={{ fontSize: 11, color: check.matched ? c.green : c.amber }}>{check.matched ? 'Found in image' : 'Needs checking'}</T>
    </View>)}
    {payment.checks.warnings.map((warning) => <T key={warning} style={{ color: c.amber, fontSize: 11, lineHeight: 18 }}>{warning}</T>)}
    <Button title="View original screenshot" secondary icon="image-outline" disabled={busy} onPress={() => void run(async () => {
      const link = await request<{ path: string }>('/api/payments/' + payment.invoiceId + '/proof-link');
      if (!link.path.startsWith('/download/payment/')) throw new Error('Invalid screenshot link.');
      await Linking.openURL(connection!.url + link.path);
    })} />
    {payment.status === 'review' && <>
      <T style={ui.help}>Screenshot checks cannot verify a bank transfer. Check your own bank or UPI app for this amount and reference before confirming.</T>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: received }} onPress={() => setReceived(!received)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
        <Icon name={received ? 'checkbox' : 'square-outline'} color={c.blue} /><T weight="bold" style={{ flex: 1, fontSize: 12, lineHeight: 20 }}>I checked my account and received this payment.</T>
      </Pressable>
      <Button title="Confirm received · Update khata" disabled={busy || !received} icon="checkmark-circle-outline" onPress={() => review('confirmed')} />
      <Button title="Reject this screenshot" secondary disabled={busy} onPress={() => review('rejected')} />
    </>}
    {payment.status === 'confirmed' && <T style={ui.help}>Receipt confirmed by merchant. Invoice paid, khata reduced and money received updated.</T>}
    {payment.status === 'rejected' && <T style={ui.help}>No receipt recorded. The customer can send PAY NOW and submit the correct screenshot.</T>}
    {!!error && <T accessibilityLiveRegion="polite" style={{ color: c.amber, fontSize: 12 }}>{error}</T>}
  </Card>;
}
