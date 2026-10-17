import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { Badge, Button, Card, Icon, Page, T, ui } from '../components/ui';
import { useWhatsApp } from '../state/whatsapp';
import { colors as c } from '../theme';

const labels = { idle: 'Opening WhatsApp', starting: 'Preparing QR', qr: 'Ready to scan', authenticating: 'Linking account', connected: 'Connected', disconnected: 'Reconnect', error: 'Try again', busy: 'Link open elsewhere' };

export default function WhatsAppScreen() {
  const { connection, snapshot, error, restored, link, connect, disconnect, request, refresh } = useWhatsApp();
  const started = useRef(false);
  const [options, setOptions] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState('');
  const status = connection ? snapshot?.status || link : link;
  const connected = !!connection && status?.state === 'connected';
  const preparing = !status || ['idle', 'starting', 'authenticating'].includes(status.state);
  useEffect(() => {
    if (!restored || started.current) return;
    started.current = true; void connect();
  }, [restored, connect]);
  const retry = async () => {
    setWorking(true); setProblem('');
    try {
      if (connection && status && ['error', 'disconnected'].includes(status.state)) await request('/api/whatsapp/stop', { method: 'POST' });
      await connect(status?.state === 'busy');
    } catch (reason) { setProblem(reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { setWorking(false); }
  };
  return <Page title="Connect WhatsApp" subtitle="Scan once. Your shop is connected." back>
    <Card style={{ gap: 19, borderColor: connected ? '#C9E9D8' : c.line, backgroundColor: connected ? '#ECF8F2' : c.white }}>
      <View style={ui.between}><Icon name="logo-whatsapp" size={38} color={connected ? c.green : '#128C7E'} /><Badge label={status ? labels[status.state] : 'Preparing QR'} tone={connected ? 'green' : 'blue'} /></View>
      <T weight="extra" style={{ fontSize: 24, lineHeight: 32 }}>{connected ? 'Merchant WhatsApp connected' : 'Scan with merchant’s WhatsApp'}</T>
      <T style={{ fontSize: 13, lineHeight: 22, color: c.muted }}>{connected
        ? 'Customers can now message this shop, place orders and receive invoices. Orders and payments appear in your khata.'
        : 'On the merchant’s phone, open WhatsApp → Linked devices → Link a device. Point its camera at the QR below.'}</T>
      {!connected && <View style={{ width: '100%', maxWidth: 300, aspectRatio: 1, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: status?.qr ? c.white : c.ice, borderRadius: 16 }}>
        {status?.qr ? <Image accessibilityLabel="WhatsApp linked-device QR" source={{ uri: status.qr }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
          : preparing ? <><ActivityIndicator color={c.blue} size="large" /><T style={[ui.help, { marginTop: 14, textAlign: 'center', paddingHorizontal: 20 }]}>{status?.state === 'authenticating' ? 'Confirming the merchant account…' : 'Opening your WhatsApp linking QR…'}</T></>
            : <Icon name="qr-code-outline" size={100} color={c.muted} />}
      </View>}
      {status?.qr && <T style={[ui.help, { textAlign: 'center' }]}>The QR refreshes automatically. Keep this screen open until WhatsApp connects.</T>}
      {!!(problem || status?.error || error) && <View style={{ backgroundColor: c.amberLight, padding: 14, borderRadius: 12 }}><T accessibilityLiveRegion="polite" style={{ fontSize: 12, lineHeight: 21, color: '#8E6112' }}>{problem || status?.error || error}</T></View>}
      {connected ? <Button title="Open Khata" icon="book-outline" onPress={() => router.push('/khata')} />
        : !preparing && !status?.qr && <Button title={working ? 'Opening…' : status?.state === 'busy' ? 'Show QR on this device' : 'Show WhatsApp QR'} icon="qr-code-outline" disabled={working} onPress={() => void retry()} />}
    </Card>
    {!connected && <Card style={{ backgroundColor: c.sky, gap: 12 }}>
      <T weight="bold" style={{ fontSize: 14 }}>Use the merchant’s phone to scan</T>
      {['Open WhatsApp on the merchant’s phone.', 'Choose Linked devices, then Link a device.', 'Scan this QR and wait for Connected.'].map((step, index) => <View key={step} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><T weight="extra" style={{ color: c.blue }}>{index + 1}</T><T style={{ flex: 1, fontSize: 12, lineHeight: 21 }}>{step}</T></View>)}
      <T style={ui.help}>If WhatsApp is on this same phone, display this linking screen on your computer or a second device. Keep the shop computer running on the same Wi-Fi.</T>
    </Card>}
    {connected && <Card style={{ gap: 12 }}><T weight="extra" style={{ fontSize: 16 }}>Your shop is ready</T><T style={ui.help}>Customer sends HI → gets the menu → confirms an order → receives an invoice → chooses Pay now or Khata.</T></Card>}
    {connection && <><Pressable accessibilityRole="button" onPress={() => setOptions(!options)} style={{ alignSelf: 'center', padding: 10 }}><T style={ui.help}>Connection options {options ? '⌃' : '⌄'}</T></Pressable>
      {options && <Card style={{ gap: 14 }}><Button title="Stop WhatsApp replies" secondary onPress={() => void request('/api/whatsapp/stop', { method: 'POST' }).then(refresh).catch(() => setProblem('Could not stop WhatsApp. Please retry.'))} />
        <Button title="Disconnect this app" secondary onPress={() => void disconnect().then(() => { started.current = false; })} />
        <T style={ui.help}>Disconnecting this app stops its sync. It does not stop the shop’s WhatsApp bot.</T>
      </Card>}
    </>}
  </Page>;
}
