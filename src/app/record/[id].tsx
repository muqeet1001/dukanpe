import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Badge, Button, Card, Chip, Empty, Icon, Page, SourceIcon, T, ui } from '../../components/ui';
import { PaymentReview } from '../../components/payment-review';
import { useWhatsApp } from '../../state/whatsapp';
import { money, partyBalance } from '../../lib/domain';
import { useBusiness } from '../../state/business';
import { colors as c } from '../../theme';

export default function RecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, dispatch, notify } = useBusiness();
  const { snapshot } = useWhatsApp();
  const record = state.records.find((item) => item.id === id);
  const [selectedParty, setSelectedParty] = useState(record?.partyId ?? '');
  if (!record) return <Page title="Record" back><Empty title="Record not found" description="This record is not available on this device. Return home to see your current records." /></Page>;
  const party = state.parties.find((item) => item.id === record.partyId);
  const confirming = record.kind === 'receipt' && record.status === 'review';
  const after = selectedParty ? partyBalance(state, selectedParty) - (record.amountPaise ?? 0) : null;
  return <Page title="The full picture" subtitle="A record you can trace back." back>
    <Card style={{ alignItems: 'center', gap: 15, paddingVertical: 28 }}>
      <SourceIcon source={record.source} size={58} />
      <T weight="extra" style={{ fontSize: 18, textAlign: 'center' }}>{record.title}</T>
      {record.amountPaise !== undefined && <T weight="extra" style={{ fontSize: 37, letterSpacing: -1 }}>{record.kind === 'receipt' ? '+' : ''}{money(record.amountPaise)}</T>}
      <Badge label={confirming ? 'Awaiting your confirmation' : record.status === 'confirmed' ? 'Merchant confirmed' : record.status === 'saved' ? 'Saved record' : 'Open request'}
        tone={confirming ? 'amber' : record.status === 'confirmed' ? 'green' : 'blue'} />
      <T style={{ color: c.muted, fontSize: 11 }}>{new Date(record.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {record.origin === 'whatsapp-bot' && !record.isDemo ? 'WhatsApp' : 'Your record'}</T>
    </Card>
    {record.invoiceId && <Button title="Open order invoice" icon="document-text-outline" onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: record.invoiceId! } })} />}
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name="document-text-outline" size={17} color={c.blue} /><T weight="extra" style={{ fontSize: 13 }}>Source evidence</T></View>
      <View style={{ padding: 15, backgroundColor: c.ice, borderRadius: 13 }}><T style={{ fontSize: 13, lineHeight: 23 }}>{record.evidence}</T></View>
      <View style={ui.between}><T style={{ color: c.muted, fontSize: 10 }}>Source</T><T weight="bold" style={{ fontSize: 11 }}>{record.source}</T></View>
      {record.note && <T style={ui.help}>{record.note}</T>}
    </Card>
    {record.origin === 'whatsapp-bot' && snapshot?.payments.find((p) => p.invoiceId === record.invoiceId) && <PaymentReview payment={snapshot.payments.find((p) => p.invoiceId === record.invoiceId)!} />}
    {confirming && record.origin !== 'whatsapp-bot' && <Card style={{ gap: 17 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icon name="shield-checkmark-outline" color={c.amber} size={21} /><T weight="extra" style={{ fontSize: 15 }}>Check it. Then confirm.</T></View>
      <T style={{ color: c.muted, fontSize: 12, lineHeight: 20 }}>This record reports a payment. Confirm that you received it and choose the right customer before changing khata.</T>
      <T weight="bold" style={{ fontSize: 11 }}>Link to a customer</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {state.parties.map((item) => <Chip key={item.id} label={item.name.split(' ')[0]} active={selectedParty === item.id} onPress={() => setSelectedParty(item.id)} />)}
        <Chip label="Keep unmatched" active={!selectedParty} onPress={() => setSelectedParty('')} />
      </View>
      {after !== null && <View style={{ padding: 14, borderRadius: 12, backgroundColor: c.sky, gap: 5 }}><T style={{ fontSize: 11, color: c.muted }}>After this confirmation</T>
        <T weight="extra" style={{ fontSize: 20 }}>{money(Math.abs(after))} <T style={{ fontSize: 11 }}>{after < 0 ? 'customer credit' : 'outstanding'}</T></T>
      </View>}
      {!selectedParty && <T style={ui.help}>The receipt will be confirmed as unmatched. No customer balance will change.</T>}
      <Button title="Confirm received payment" icon="checkmark-circle-outline" onPress={() => {
        dispatch({ type: 'confirm-payment', id: record.id, partyId: selectedParty || null });
        notify('Payment confirmed. Your records are updated.');
      }} />
    </Card>}
    {party && <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/customer/[id]', params: { id: party.id } })}>
      <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ gap: 5 }}><T weight="bold">{party.name}</T><T style={{ fontSize: 11, color: c.muted }}>Open connected khata and records</T></View><Icon name="arrow-forward-outline" color={c.blue} /></Card>
    </Pressable>}
    {record.status === 'confirmed' && record.kind === 'receipt' && <T style={[ui.help, { textAlign: 'center' }]}>Confirmed by the merchant. This does not indicate bank verification or settlement.</T>}
  </Page>;
}
