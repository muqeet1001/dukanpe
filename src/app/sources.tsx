import { router } from 'expo-router';
import React, { useState } from 'react';
import { Modal, View } from 'react-native';
import { Badge, Button, Card, Icon, Page, SourceIcon, T, ui } from '../components/ui';
import { Source } from '../lib/domain';
import { useBusiness } from '../state/business';
import { colors as c } from '../theme';

export default function SourcesScreen() {
  const { state, reset } = useBusiness();
  const [resetVisible, setResetVisible] = useState(false);
  return <Page title="Your sources" subtitle="Know where every record comes from." back>
    <Card style={{ backgroundColor: c.sky, borderColor: '#DDF0FB', gap: 11 }}>
      <Badge label="DEMO WORKSPACE" /><T weight="extra" style={{ fontSize: 21, letterSpacing: -0.6 }}>One shop. One clear picture.</T>
      <T style={{ fontSize: 12, color: '#6585A0', lineHeight: 21 }}>This prototype uses fictional records saved on this device. Your real messages, bank accounts and payment apps are not connected.</T>
    </Card>
    {([
      { source: 'WhatsApp', title: 'WhatsApp Business', description: 'Orders, promises and supplier conversations.', filter: 'WhatsApp', future: 'Connect an authorised Business account in the backend.' },
      { source: 'PhonePe', title: 'Payment alerts', description: 'GPay and PhonePe alerts in one inbox.', filter: 'payments', future: 'Real Android capture needs a native notification listener, permission and a development build.' },
      { source: 'Bill', title: 'Bills & invoices', description: 'Your bill details, linked to the full story.', filter: 'Bill', future: 'Document capture and OCR can connect to these record screens.' },
    ] as { source: Source; title: string; description: string; filter: string; future: string }[]).map((source) => <Card key={source.title} style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><SourceIcon source={source.source} /><View style={{ flex: 1, gap: 6 }}><T weight="extra" style={{ fontSize: 14 }}>{source.title}</T><T style={{ color: c.muted, fontSize: 11 }}>{source.description}</T></View></View>
      <View style={ui.between}><Badge label="Sample records" /><T style={{ color: c.muted, fontSize: 10 }}>Not connected</T></View>
      <Button title="Explore sample records" secondary icon="arrow-forward-outline" onPress={() => router.push({ pathname: '/records', params: { source: source.filter } })} />
      <T style={ui.help}>{source.future}</T>
    </Card>)}
    <Card style={{ gap: 13 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="phone-portrait-outline" size={19} color={c.blue} /><T weight="extra" style={{ fontSize: 14 }}>Local demo storage</T></View>
      <T style={{ color: c.muted, fontSize: 12, lineHeight: 20 }}>{state.records.length} records and {state.parties.length} customer accounts. Changes survive app refresh on this device. This demo store is not encrypted financial storage.</T>
      <Button title="Restore fresh sample data" secondary icon="refresh-outline" onPress={() => setResetVisible(true)} />
    </Card>
    <Modal visible={resetVisible} transparent animationType="fade" onRequestClose={() => setResetVisible(false)}>
      <View style={{ flex: 1, backgroundColor: '#00234F77', padding: 26, alignItems: 'center', justifyContent: 'center' }}><Card style={{ width: '100%', maxWidth: 380, gap: 18 }}>
        <T weight="extra" style={{ fontSize: 21 }}>Start a fresh demo?</T><T style={{ color: c.muted, lineHeight: 22, fontSize: 13 }}>Your demo entries, payment confirmations and completed follow-ups will be replaced with the original sample records.</T>
        <Button title="Restore sample data" onPress={() => { reset(); setResetVisible(false); }} /><Button title="Keep my changes" secondary onPress={() => setResetVisible(false)} />
      </Card></View>
    </Modal>
  </Page>;
}
