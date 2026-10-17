import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppWordmark, Card, Empty, Icon, IconButton, Page, RecordRow, Section, ServiceIcon, T, ui } from '../../components/ui';
import { money, totals } from '../../lib/domain';
import { useBusiness } from '../../state/business';
import { colors as c, fonts as f } from '../../theme';

export default function HomeScreen() {
  const { state } = useBusiness();
  const [query, setQuery] = useState('');
  const summary = totals(state);
  const recentRecords = [...state.records].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5);
  const search = () => router.push({ pathname: '/records', params: { query: query.trim(), focus: query.trim() ? 'false' : 'true' } });

  return <Page>
    <View style={s.header}>
      <AppWordmark />
      <IconButton name="person-outline" label="Shop and source settings" onPress={() => router.push('/sources')} style={s.profile} />
    </View>

    <View style={s.businessSection}>
      <View style={ui.between}>
        <View style={{ gap: 5 }}><T weight="bold" style={s.heading}>Your business today</T><T style={s.summaryDate}>{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</T></View>
        <View style={s.sampleBadge}><T weight="semi" style={s.sampleLabel}>Your records</T></View>
      </View>

      <Card style={s.salesCard}>
        <View style={s.salesAccent} />
        <View style={{ flex: 1, gap: 7 }}>
          <T weight="semi" style={s.salesLabel}>Recorded sales</T>
          <T weight="extra" style={s.salesAmount}>{money(summary.sales)}</T>
          <T style={s.salesHelp}>Sales you recorded today</T>
        </View>
        <View style={s.salesIcon}><Icon name="storefront-outline" size={30} color={c.navy} /></View>
      </Card>

      <View style={s.metrics}>
        <Pressable accessibilityRole="button" accessibilityLabel="View payment history" onPress={() => router.push({ pathname: '/records', params: { source: 'payments' } })}
          style={({ pressed }) => [s.metricCard, s.receivedCard, pressed && s.pressed]}>
          <View style={ui.between}><View style={s.receivedIcon}><Icon name="arrow-down-outline" size={21} color={c.navy} /></View><Icon name="arrow-forward" size={16} color={c.navy} /></View>
          <View style={{ gap: 7 }}><T weight="semi" style={s.metricLabel}>Money received</T><T weight="extra" style={s.metricAmount}>{money(summary.receipts)}</T></View>
          <T style={s.metricHelp}>Confirmed payments</T>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="View customer dues in Khata" onPress={() => router.push('/khata')}
          style={({ pressed }) => [s.metricCard, s.duesCard, pressed && s.pressed]}>
          <View style={ui.between}><View style={s.duesIcon}><Icon name="book-outline" size={21} color="#8EDCF9" /></View><Icon name="arrow-forward" size={16} color="#8EDCF9" /></View>
          <View style={{ gap: 7 }}><T weight="semi" style={[s.metricLabel, { color: '#C7DEF3' }]}>Customer dues</T><T weight="extra" style={[s.metricAmount, { color: c.white }]}>{money(summary.dues)}</T></View>
          <T style={[s.metricHelp, { color: '#8EDCF9' }]}>All dues · View khata</T>
        </Pressable>
      </View>
    </View>

    {summary.review > 0 && <Pressable accessibilityRole="button" onPress={() => router.push('/follow-ups')}>
      <Card style={{ backgroundColor: c.amberLight, flexDirection: 'row', alignItems: 'center', gap: 12 }}><Icon name="shield-checkmark-outline" color={c.amber} /><View style={{ flex: 1, gap: 5 }}><T weight="extra" style={{ fontSize: 14 }}>{summary.review} payment{summary.review === 1 ? '' : 's'} to verify</T><T style={{ fontSize: 11, color: c.muted }}>Review screenshots before updating khata</T></View><Icon name="arrow-forward-outline" color={c.amber} /></Card>
    </Pressable>}
    <View style={s.searchSection}>
      <View style={s.searchBox}>
        <Icon name="search-outline" size={23} color={c.navy} />
        <TextInput accessibilityLabel="Search your business" value={query} onChangeText={setQuery} onSubmitEditing={search}
          returnKeyType="search" placeholder="Search your business" placeholderTextColor="#5D7189" style={s.searchInput} />
        <IconButton name="arrow-forward-outline" label="Search business records" onPress={search} color={c.white} style={s.searchButton} />
      </View>
      <T style={s.searchHint}>Find a customer, payment, bill or conversation.</T>
    </View>

    <View style={s.actions}>
      {[
        { title: 'Add sale', icon: 'add-outline' as const, onPress: () => router.push('/entry') },
        { title: 'Add udhaar', icon: 'person-add-outline' as const, onPress: () => router.push({ pathname: '/entry', params: { mode: 'credit' } }) },
        { title: 'Payments', icon: 'receipt-outline' as const, onPress: () => router.push({ pathname: '/records', params: { source: 'payments' } }) },
      ].map((action) => <Pressable key={action.title} accessibilityRole="button" onPress={action.onPress} style={({ pressed }) => [s.action, pressed && { opacity: 0.65 }]}>
        <ServiceIcon name={action.icon} size={46} /><T weight="semi" style={s.actionLabel}>{action.title}</T>
      </Pressable>)}
    </View>

    <View>
      <Section title="Recent activity" action="View all" onPress={() => router.push('/records')} />
      <Card style={{ paddingVertical: 0 }}>
        {recentRecords.length ? recentRecords.map((record, index) => <RecordRow key={record.id} record={record} last={index === recentRecords.length - 1} />)
          : <Empty title="Your history starts here" description="Add a sale to see your business activity here." />}
      </Card>
    </View>
    <View style={s.footer}><Icon name="link-outline" size={13} color="#8B9BA9" /><T style={{ color: '#8B9BA9', fontSize: 11 }}>Your business, all together.</T></View>
  </Page>;
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  profile: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E7F1F8', borderWidth: 1, borderColor: '#D9E7F1' },
  searchSection: { gap: 10, marginBottom: 2 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 9, paddingLeft: 16, minHeight: 66, backgroundColor: c.white, borderRadius: 18, borderColor: '#B8DFF0', borderWidth: 1.5 },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 11, fontFamily: f.medium, fontSize: 15, fontWeight: '500', color: c.navy },
  searchButton: { width: 40, height: 40, backgroundColor: c.navy, borderRadius: 12 },
  searchHint: { fontSize: 11, color: '#7A8A9C', paddingLeft: 4 },
  businessSection: { gap: 13 },
  heading: { fontSize: 19, letterSpacing: -0.5, color: c.navy },
  summaryDate: { fontSize: 11, color: '#7A8A9C' },
  sampleBadge: { paddingVertical: 6, paddingHorizontal: 9, backgroundColor: '#E4F3FC', borderRadius: 8 },
  sampleLabel: { fontSize: 9, color: '#327098' },
  salesCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 20, paddingLeft: 23, borderRadius: 18, borderColor: '#D9E8F3', minHeight: 148, overflow: 'hidden' },
  salesAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: c.cyan },
  salesLabel: { fontSize: 12, color: '#526E8B' },
  salesAmount: { fontSize: 38, letterSpacing: -1.3, color: c.navy },
  salesHelp: { fontSize: 10, color: '#8496A9' },
  salesIcon: { height: 59, width: 59, borderRadius: 17, backgroundColor: '#E7F6FF', alignItems: 'center', justifyContent: 'center' },
  metrics: { flexDirection: 'row', gap: 12 },
  metricCard: { flex: 1, minWidth: 0, minHeight: 175, padding: 16, borderRadius: 18, borderWidth: 1, gap: 14, justifyContent: 'space-between' },
  receivedCard: { backgroundColor: '#E0F3FF', borderColor: '#CAE8F8' },
  duesCard: { backgroundColor: c.navy, borderColor: c.navy },
  receivedIcon: { width: 33, height: 33, borderRadius: 11, backgroundColor: c.white, alignItems: 'center', justifyContent: 'center' },
  duesIcon: { width: 33, height: 33, borderRadius: 11, backgroundColor: '#164680', alignItems: 'center', justifyContent: 'center' },
  metricLabel: { fontSize: 12, color: '#315A80' },
  metricAmount: { fontSize: 27, letterSpacing: -0.7, color: c.navy },
  metricHelp: { fontSize: 10, color: '#4C7596', lineHeight: 15 },
  pressed: { opacity: 0.75 },
  actions: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginBottom: 1 },
  action: { flex: 1, alignItems: 'center', gap: 10 },
  actionLabel: { fontSize: 12, color: '#293D56' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 3 },
});
