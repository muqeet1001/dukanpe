import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Card, Chip, Empty, Page, RecordRow, SearchField, T } from '../components/ui';
import { useBusiness } from '../state/business';
import { colors as c } from '../theme';

const filters = ['All records', 'Payments', 'WhatsApp', 'Bills', 'Review'];
export default function RecordsScreen() {
  const params = useLocalSearchParams<{ source?: string; filter?: string; query?: string; focus?: string }>();
  const initial = params.filter === 'review' ? 'Review' : params.source === 'payments' ? 'Payments' : params.source === 'Bill' ? 'Bills' : params.source === 'WhatsApp' ? 'WhatsApp' : 'All records';
  const [filter, setFilter] = useState(initial);
  const [query, setQuery] = useState(params.query ?? '');
  const { state } = useBusiness();
  const records = state.records.filter((item) => {
    const matches = filter === 'All records' || filter === 'Payments' && item.kind === 'receipt'
      || filter === 'Bills' && item.kind === 'invoice' || filter === 'WhatsApp' && item.source === 'WhatsApp'
      || filter === 'Review' && item.status === 'review';
    return matches && (item.title + ' ' + item.subtitle + ' ' + item.evidence + ' ' + item.source).toLowerCase().includes(query.toLowerCase());
  });
  return <Page title="All together" subtitle="Your chats, bills and payments. One place." back>
    <SearchField value={query} onChangeText={setQuery} autoFocus={params.focus === 'true'} placeholder="Search a name, bill, chat or payment" />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {filters.map((item) => <Chip key={item} label={item} active={filter === item} onPress={() => setFilter(item)} />)}
    </ScrollView>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T weight="bold" style={{ color: c.muted, fontSize: 11 }}>{records.length} records</T><T style={{ color: c.muted, fontSize: 10 }}>Sample data</T></View>
    <Card style={{ paddingVertical: 0 }}>{records.length ? records.map((record, index) => <RecordRow key={record.id} record={record} last={index === records.length - 1} />)
      : <Empty title="No matching records" description="Try a customer name, source or another keyword." />}</Card>
  </Page>;
}
