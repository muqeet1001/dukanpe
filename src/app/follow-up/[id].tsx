import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Empty, Field, Icon, Page, T, ui } from '../../components/ui';
import { money, partyBalance } from '../../lib/domain';
import { useBusiness } from '../../state/business';
import { colors as c } from '../../theme';

export default function FollowUpScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, dispatch, notify } = useBusiness();
  const task = state.followUps.find((item) => item.id === id);
  const [editedDraft, setEditedDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!task) return <Page title="Follow-up" back><Empty title="Follow-up not found" description="Open a current item from the Follow-ups tab." /></Page>;
  const party = state.parties.find((item) => item.id === task.partyId);
  const defaultDraft = task.kind === 'collection'
    ? 'Hi ' + (party?.name.split(' ')[0] ?? 'there') + ', a gentle reminder about your outstanding ' + money(party ? Math.max(0, partyBalance(state, party.id)) : 0) + '. You mentioned paying today. Please let me know when convenient. Thank you!'
    : task.kind === 'invoice' ? 'Hi Shree Foods, our accepted quote was ₹480 per rice bag, but invoice SF-1042 shows ₹500. Could you please check the ₹100 difference for 5 bags? Thank you.'
    : 'Hi Shree Foods, please confirm whether our rice delivery is on schedule for tomorrow before 10 am. Thank you!';
  return <Page title="Time for a follow-up" subtitle="The context, evidence and next step." back>
    <Card style={{ gap: 16 }}>
      <View style={ui.between}><View style={{ backgroundColor: c.sky, padding: 12, borderRadius: 15 }}><Icon name={task.kind === 'invoice' ? 'document-text-outline' : task.kind === 'delivery' ? 'cube-outline' : 'chatbubble-ellipses-outline'} color={c.blue} /></View>
        <Badge label={task.status === 'done' ? 'Completed' : task.due} tone={task.status === 'done' ? 'green' : task.priority === 'high' ? 'amber' : 'blue'} /></View>
      <T weight="extra" style={{ fontSize: 23, letterSpacing: -0.6, lineHeight: 31 }}>{task.title}</T>
      <T style={{ fontSize: 13, color: c.muted, lineHeight: 22 }}>{task.description}</T>
    </Card>
    <Card style={{ gap: 12 }}><T weight="extra" style={{ fontSize: 14 }}>Why this appeared</T><View style={{ padding: 15, backgroundColor: c.ice, borderRadius: 13 }}><T style={{ fontSize: 13, lineHeight: 23 }}>{task.evidence}</T></View>
      {task.recordId && <Button title="Open supporting record" secondary icon="document-text-outline" onPress={() => router.push({ pathname: '/record/[id]', params: { id: task.recordId! } })} />}
    </Card>
    {task.kind !== 'payment' && <Card style={{ gap: 15 }}><View style={ui.between}><T weight="extra" style={{ fontSize: 14 }}>A message to get started</T><Badge label="DRAFT ONLY" /></View>
      <Field accessibilityLabel="Reminder message draft" multiline value={editedDraft ?? defaultDraft} onChangeText={(value) => { setEditedDraft(value); setCopied(false); }} style={{ minHeight: 145, textAlignVertical: 'top', fontSize: 12, lineHeight: 21, backgroundColor: c.ice, borderWidth: 0 }} />
      <Button title={copied ? 'Copied to clipboard' : 'Copy reminder'} icon={copied ? 'checkmark-outline' : 'copy-outline'} onPress={async () => {
        try { await Clipboard.setStringAsync(editedDraft ?? defaultDraft); setCopied(true); notify('Draft copied. Choose where to send it.'); }
        catch { notify('Clipboard unavailable. You can select the draft text.'); }
      }} />
      <T style={ui.help}>You decide whether to send it. Dukanpe does not send this message.</T>
    </Card>}
    {task.kind === 'payment' && task.recordId && <Button title="Review this payment" icon="shield-checkmark-outline" onPress={() => router.push({ pathname: '/record/[id]', params: { id: task.recordId! } })} />}
    <Button secondary title={task.status === 'done' ? 'Reopen follow-up' : 'Mark follow-up done'} icon="checkmark-done-outline" onPress={() => {
      dispatch({ type: 'follow-up', id: task.id, done: task.status !== 'done' }); notify(task.status === 'done' ? 'Follow-up reopened' : 'Follow-up completed');
    }} />
    <T style={[ui.help, { textAlign: 'center' }]}>Completing a follow-up changes the task status. Payment confirmation happens in the payment record.</T>
  </Page>;
}
