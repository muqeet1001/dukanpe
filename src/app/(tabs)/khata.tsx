import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Avatar, Badge, Card, Chip, Empty, Icon, IconButton, Page, SearchField, Section, T, ui } from '../../components/ui';
import { money, partyBalance, totals } from '../../lib/domain';
import { useBusiness } from '../../state/business';
import { useWhatsApp } from '../../state/whatsapp';
import { colors as c } from '../../theme';

export default function KhataScreen() {
  const { state } = useBusiness();
  const { connection, snapshot, error } = useWhatsApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All customers');
  const summary = totals(state);
  const parties = state.parties.filter((party) => party.name.toLowerCase().includes(query.toLowerCase())
    && (filter !== 'Has dues' || partyBalance(state, party.id) > 0)
    && (filter !== 'Settled' || partyBalance(state, party.id) <= 0));
  return <Page title="Your khata" subtitle="Every customer. Every rupee. Clear."
    right={<IconButton name="add-outline" label="Add a credit sale" onPress={() => router.push({ pathname: '/entry', params: { mode: 'credit' } })} style={{ backgroundColor: '#E2F5FE' }} color={c.blue} />}>
    <Card style={{ backgroundColor: c.navy, borderColor: c.navy, gap: 12 }}>
      <View style={ui.between}><T style={{ color: '#C7DEF3', fontSize: 12 }}>Total customer dues</T><Icon name="wallet-outline" size={22} color="#8EDCF9" /></View>
      <T weight="extra" style={{ fontSize: 35, color: c.white, letterSpacing: -1 }}>{money(summary.dues)}</T>
      <View style={{ backgroundColor: '#19477D', height: 1, marginVertical: 3 }} />
      <View style={ui.between}><T style={{ color: '#C7DEF3', fontSize: 11 }}>{state.parties.filter((party) => partyBalance(state, party.id) > 0).length} customers with a balance</T>
        <Badge label="Confirmed records" /></View>
    </Card>
    <Pressable accessibilityRole="button" accessibilityLabel="Open WhatsApp orders and invoices" onPress={() => router.push('/whatsapp')}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.sky, borderColor: '#D6EDF9' }}>
        <Icon name="logo-whatsapp" color={c.navy} size={29} /><View style={{ flex: 1, gap: 5 }}><T weight="bold" style={{ fontSize: 14 }}>WhatsApp orders</T>
          <T style={{ fontSize: 10, lineHeight: 17, color: c.muted }}>{error ? 'Bot sync needs attention' : snapshot?.status.state === 'connected' ? 'Linked · Orders become invoices and khata' : connection ? 'Server paired · Link WhatsApp or try a demo' : 'Connect your bot · Order → invoice → khata'}</T></View><Icon name="chevron-forward" size={17} />
      </Card>
    </Pressable>
    <SearchField value={query} onChangeText={setQuery} placeholder="Find a customer" />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {['All customers', 'Has dues', 'Settled'].map((item) => <Chip key={item} label={item} active={filter === item} onPress={() => setFilter(item)} />)}
    </ScrollView>
    <View><Section title="Customer accounts" action={parties.length + ' customers'} />
      <Card style={{ paddingVertical: 2 }}>
        {parties.length ? parties.map((party, index) => {
          const balance = partyBalance(state, party.id);
          const reviews = state.records.filter((record) => record.partyId === party.id && record.status === 'review').length;
          return <Pressable accessibilityRole="button" key={party.id} onPress={() => router.push({ pathname: '/customer/[id]', params: { id: party.id } })}
            style={[{ paddingVertical: 18, flexDirection: 'row', alignItems: 'center', gap: 13 }, index < parties.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.line }]}>
            <Avatar initials={party.initials} tone={party.color} />
            <View style={{ flex: 1, gap: 6 }}><T weight="bold" style={{ fontSize: 13 }}>{party.name}</T>
              <T style={{ fontSize: 10, color: c.muted }}>{reviews ? reviews + ' payment alert to review' : 'Account up to date'}</T></View>
            <View style={{ alignItems: 'flex-end', gap: 5 }}><T weight="extra" style={{ fontSize: 16 }}>{money(Math.abs(balance))}</T>
              <T style={{ color: balance > 0 ? c.amber : c.green, fontSize: 10 }}>{balance > 0 ? 'To collect' : balance < 0 ? 'Customer credit' : 'Settled'}</T></View>
            <Icon name="chevron-forward" size={15} color="#A4B2C0" />
          </Pressable>;
        }) : <Empty title="No customers found" description="Try a different name or filter." />}
      </Card>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 5 }}><Icon name="shield-checkmark-outline" size={17} color={c.blue} />
      <T style={[ui.help, { flex: 1 }]}>Payment alerts stay out of khata until you confirm them. Every balance has a record behind it.</T></View>
  </Page>;
}
