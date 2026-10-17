import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Badge, Card, Chip, Empty, Icon, IconName, Page, T, ui } from '../../components/ui';
import { money, partyBalance } from '../../lib/domain';
import { useBusiness } from '../../state/business';
import { colors as c } from '../../theme';

const icons: Record<string, IconName> = { collection: 'chatbubble-ellipses-outline', invoice: 'document-text-outline', delivery: 'cube-outline', payment: 'shield-checkmark-outline' };
const labels: Record<string, string> = { collection: 'Payment promise', invoice: 'Price check', delivery: 'Delivery', payment: 'Payment review' };
export default function FollowUpsScreen() {
  const { state, dispatch, notify } = useBusiness();
  const [filter, setFilter] = useState('Open');
  const open = state.followUps.filter((item) => item.status === 'open');
  const tasks = state.followUps.filter((item) => filter === 'Done' ? item.status === 'done'
    : item.status === 'open' && (filter === 'Open' || item.due === filter));
  return <Page title="Follow-ups" subtitle="Your next move, already found." right={<View style={{ backgroundColor: c.sky, padding: 12, borderRadius: 16 }}><Icon name="sparkles" color={c.blue} /></View>}>
    <Card style={{ backgroundColor: '#E6F6FE', borderColor: '#DCF0FC', gap: 12 }}>
      <View style={ui.between}><Badge label="YOUR DAILY BRIEF" /><Icon name="sunny-outline" size={20} color={c.blue} /></View>
      <T weight="extra" style={{ fontSize: 23, lineHeight: 31, letterSpacing: -0.8 }}>{open.length ? open.length + (open.length === 1 ? ' thing worth\nyour attention.' : ' things worth\nyour attention.') : 'You’re all caught up.'}</T>
      <T style={{ fontSize: 12, lineHeight: 20, color: '#5F7F9B' }}>Payment screenshots waiting for review, linked to customer orders and khata.</T>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 2 }}>
        <T weight="bold" style={{ color: c.navy, fontSize: 11 }}>{open.filter((item) => item.due === 'Today').length} due today</T>
        <T weight="bold" style={{ color: c.amber, fontSize: 11 }}>{open.filter((item) => item.priority === 'high').length} need attention</T>
      </View>
    </Card>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {['Open', 'Today', 'Tomorrow', 'Done'].map((item) => <Chip key={item} label={item} active={filter === item} onPress={() => setFilter(item)} />)}
    </ScrollView>
    {tasks.length ? tasks.map((task) => <Card key={task.id} style={{ gap: 15 }}>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/follow-up/[id]', params: { id: task.id } })} style={{ gap: 15 }}>
        <View style={ui.between}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><View style={{ backgroundColor: task.priority === 'high' ? c.amberLight : c.sky, padding: 9, borderRadius: 12 }}><Icon name={icons[task.kind]} color={task.priority === 'high' ? c.amber : c.blue} size={17} /></View>
            <T weight="bold" style={{ color: c.muted, fontSize: 10 }}>{labels[task.kind]}</T></View>
          <Badge label={task.status === 'done' ? 'Done' : task.due} tone={task.status === 'done' ? 'green' : task.priority === 'high' ? 'amber' : 'blue'} />
        </View>
        <T weight="extra" style={{ fontSize: 17, letterSpacing: -0.4 }}>{task.title}</T>
        <T style={{ color: c.muted, fontSize: 12, lineHeight: 20 }}>{task.description}</T>
        {task.kind === 'collection' && task.partyId && <View style={{ backgroundColor: c.ice, borderRadius: 11, padding: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
          <T style={{ fontSize: 11, color: c.muted }}>Current confirmed dues</T><T weight="extra" style={{ fontSize: 13 }}>{money(partyBalance(state, task.partyId))}</T>
        </View>}
      </Pressable>
        <View style={{ height: 1, backgroundColor: c.line }} />
        <View style={ui.between}>
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/follow-up/[id]', params: { id: task.id } })}><T weight="bold" style={{ fontSize: 11, color: c.blue }}>View evidence & act  →</T></Pressable>
          {!task.id.startsWith('wa-payment-') && <Pressable accessibilityRole="button" accessibilityLabel={task.status === 'done' ? 'Reopen follow-up' : 'Mark follow-up done'} hitSlop={10}
            onPress={(event) => { event.stopPropagation(); dispatch({ type: 'follow-up', id: task.id, done: task.status !== 'done' }); notify(task.status === 'done' ? 'Follow-up reopened' : 'Follow-up marked done'); }}
            style={{ padding: 6, borderRadius: 8, backgroundColor: task.status === 'done' ? c.greenLight : c.ice }}>
            <Icon name={task.status === 'done' ? 'checkmark-circle' : 'checkmark-outline'} size={19} color={task.status === 'done' ? c.green : c.muted} />
          </Pressable>}
        </View>
      </Card>) : <Card><Empty title={filter === 'Done' ? 'No completed follow-ups yet' : 'Nothing waiting here'} description="Your open promises and record checks appear here. You can reopen completed follow-ups anytime." icon="checkmark-done-circle-outline" /></Card>}
    <T style={[ui.help, { textAlign: 'center' }]}>Payment reviews update automatically when you confirm or reject a screenshot.</T>
  </Page>;
}
