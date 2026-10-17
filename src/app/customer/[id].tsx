import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Avatar, Badge, Button, Card, Empty, Page, RecordRow, Section, T, ui } from '../../components/ui';
import { money, partyBalance } from '../../lib/domain';
import { useBusiness } from '../../state/business';
import { colors as c } from '../../theme';

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useBusiness();
  const party = state.parties.find((item) => item.id === id);
  if (!party) return <Page title="Customer" back><Empty title="Customer not found" description="Open an account from the Khata tab." /></Page>;
  const balance = partyBalance(state, party.id);
  const records = state.records.filter((item) => item.partyId === party.id);
  const reviews = records.filter((item) => item.status === 'review').length;
  return <Page title="Customer account" back>
    <View style={{ alignItems: 'center', gap: 10 }}><Avatar initials={party.initials} tone={party.color} size={70} />
      <T weight="extra" style={{ fontSize: 24, letterSpacing: -0.7 }}>{party.name}</T><T style={{ fontSize: 11, color: c.muted, textAlign: 'center' }}>{party.note}</T>
    </View>
    <Card style={{ alignItems: 'center', backgroundColor: c.navy, borderColor: c.navy, paddingVertical: 26, gap: 9 }}>
      <T style={{ color: '#B5D3EF', fontSize: 12 }}>{balance > 0 ? 'Confirmed outstanding' : balance < 0 ? 'Customer credit' : 'All settled'}</T>
      <T weight="extra" style={{ fontSize: 40, color: c.white, letterSpacing: -1 }}>{money(Math.abs(balance))}</T><Badge label="Based on confirmed records" />
    </Card>
    {reviews > 0 && <Card style={{ backgroundColor: c.amberLight, borderColor: '#F4E9D0', gap: 8 }}><T weight="bold" style={{ color: c.amber, fontSize: 12 }}>{reviews} payment alert awaiting confirmation</T>
      <T style={{ color: '#9C865E', fontSize: 11, lineHeight: 19 }}>This amount has not been deducted from the balance above. Open the alert below to review it.</T></Card>}
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Button title="Add udhaar" icon="add-outline" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/entry', params: { mode: 'credit', partyId: party.id } })} />
      <Button title="Ask about them" icon="sparkles-outline" secondary style={{ flex: 1 }} onPress={() => router.push({ pathname: '/ask', params: { question: 'What does ' + party.name.split(' ')[0] + ' owe?' } })} />
    </View>
    <View><Section title="Connected records" action={records.length + ' records'} />
      <Card style={{ paddingVertical: 0 }}>{records.map((record, index) => <RecordRow key={record.id} record={record} last={index === records.length - 1} />)}</Card>
    </View>
    <Card style={{ gap: 10 }}><View style={ui.between}><T style={{ color: c.muted, fontSize: 11 }}>Opening balance</T><T weight="bold" style={{ fontSize: 12 }}>{money(party.openingBalancePaise)}</T></View>
      <T style={ui.help}>Opening balance + confirmed credit sales − confirmed receipts. Requests and unconfirmed alerts do not change khata.</T></Card>
  </Page>;
}
