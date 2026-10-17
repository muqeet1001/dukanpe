import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Icon, Page, T, ui } from '../components/ui';
import { useBusiness } from '../state/business';
import { useWhatsApp } from '../state/whatsapp';
import { colors as c } from '../theme';

export default function SourcesScreen() {
  const { state } = useBusiness();
  const { snapshot, error } = useWhatsApp();
  return <Page title="Your shop" subtitle="Connected records. Clear balances." back>
    <Card style={{ backgroundColor: c.sky, gap: 14 }}><Badge label="MERCHANT WORKSPACE" /><T weight="extra" style={{ fontSize: 23 }}>{snapshot?.shopName || 'Dukanpe'}</T>
      <T style={ui.help}>Your live WhatsApp orders, invoices, payment evidence and khata stay connected. Manual entries are saved on this device.</T>
    </Card>
    <Card style={{ gap: 14 }}><View style={ui.between}><T weight="extra">WhatsApp orders</T><Badge label={snapshot?.status.state === 'connected' ? 'Connected' : 'Connect'} /></View>
      <T style={ui.help}>Customers order in chat, receive an invoice, then choose Pay now or Khata. Payment screenshots appear in Follow-ups for your review.</T>
      <Button title="WhatsApp connection" icon="logo-whatsapp" onPress={() => router.push('/whatsapp')} />
    </Card>
    <Card style={{ gap: 12 }}><View style={{ flexDirection: 'row', gap: 9 }}><Icon name="qr-code-outline" color={c.blue} /><T weight="extra">Receive UPI payments</T></View>
      <T selectable weight="bold" style={{ fontSize: 16 }}>{snapshot?.merchant?.upiId || 'Set MERCHANT_UPI_ID on the bot server'}</T>
      <T style={ui.help}>Order QRs use this UPI ID and the exact invoice total. Check your bank or payment app before confirming a receipt. Bank accounts and payment apps are not linked for automatic settlement verification.</T>
    </Card>
    <Card style={{ gap: 12 }}><T weight="extra">Your records</T><T style={ui.help}>{state.records.length} records · {state.parties.length} customer accounts. WhatsApp records sync from the server; no sample transactions are included.</T>
      <Button title="Open all records" secondary onPress={() => router.push('/records')} />
      <Button title="Review payment screenshots" secondary onPress={() => router.push('/follow-ups')} />
    </Card>
    {!!error && <T style={{ color: c.amber, fontSize: 12 }}>{error}</T>}
  </Page>;
}
