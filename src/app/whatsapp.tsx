import { router } from 'expo-router';
import React, { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Badge, Button, Card, Field, Icon, Page, T, ui } from '../components/ui';
import { defaultBotUrl } from '../lib/bot-api';
import { useWhatsApp } from '../state/whatsapp';
import { colors as c } from '../theme';

const labels = { idle: 'Not connected', starting: 'Opening WhatsApp…', qr: 'Scan to connect', authenticating: 'Signing in…', connected: 'Connected', disconnected: 'Disconnected', error: 'Needs attention' };

export default function WhatsAppScreen() {
  const { connection, snapshot, error, pair, disconnect, refresh, request } = useWhatsApp();
  const [url, setUrl] = useState(defaultBotUrl);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [settings, setSettings] = useState(false);
  const status = snapshot?.status;
  const connected = status?.state === 'connected';
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setProblem('');
    try { await work(); } catch (reason) { setProblem(reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  return <Page title="Connect WhatsApp" subtitle="Your customers order there. Your khata updates here." back>
    {!!(problem || error || status?.error) && <Card style={{ backgroundColor: c.amberLight }}>
      <T accessibilityLiveRegion="polite" style={{ color: '#8E6112', fontSize: 12, lineHeight: 20 }}>{problem || error || status?.error}</T>
    </Card>}

    {!connection ? <Card style={{ gap: 17 }}>
      <Icon name="logo-whatsapp" size={38} color={c.navy} />
      <T weight="extra" style={{ fontSize: 22 }}>Connect your shop</T>
      <T style={ui.help}>Pair your bot server once, then link your business WhatsApp number.</T>
      <Field label="Bot server address" accessibilityLabel="Bot server address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="http://192.168.1.10:4000" />
      <Field label="Pairing code" accessibilityLabel="Bot pairing code" value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Code from your bot server" />
      <Button title={busy ? 'Connecting…' : 'Connect bot server'} disabled={busy} onPress={() => void run(async () => { await pair(url, token); setToken(''); })} icon="link-outline" />
    </Card> : <>
      <Card style={{ gap: 18, backgroundColor: connected ? '#ECF8F2' : c.white, borderColor: connected ? '#C9E9D8' : c.line }}>
        <View style={ui.between}><Icon name="logo-whatsapp" size={38} color={connected ? c.green : c.navy} /><Badge label={status ? labels[status.state] : 'Checking…'} tone={connected ? 'green' : 'blue'} /></View>
        <T weight="extra" style={{ fontSize: 23 }}>{connected ? 'You’re connected.' : 'Link your WhatsApp'}</T>
        <T style={{ fontSize: 13, lineHeight: 22, color: c.muted }}>{connected
          ? 'Customers chat, choose products and receive invoices on WhatsApp. Their name and order total appear automatically in your khata.'
          : 'Scan the QR using your business phone. WhatsApp → Linked devices → Link a device.'}</T>
        {status?.qr && <View style={{ alignItems: 'center' }}>
          <Image accessibilityLabel="WhatsApp account linking QR" source={{ uri: status.qr }} resizeMode="contain" style={{ width: 250, height: 250, backgroundColor: c.white }} />
        </View>}
        {connected ? <Button title="Open Khata" icon="book-outline" onPress={() => router.push('/khata')} />
          : (!status || ['idle', 'error', 'disconnected'].includes(status.state)) && <Button title={busy ? 'Connecting…' : 'Connect WhatsApp'} icon="qr-code-outline" disabled={busy} onPress={() => void run(async () => { await request('/api/whatsapp/stop', { method: 'POST' }); await request('/api/whatsapp/start', { method: 'POST' }); await refresh(); })} />}
      </Card>

      <Card style={{ gap: 13, backgroundColor: c.sky, borderColor: '#D2EAF7' }}>
        <T weight="bold" style={{ fontSize: 15 }}>Everything starts with HI</T>
        <T style={{ fontSize: 12, lineHeight: 22, color: c.navy }}>Customer sends HI on WhatsApp → gets the menu → sends an order → receives an invoice.</T>
        <View style={{ height: 1, backgroundColor: '#D2EAF7' }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icon name="checkmark-circle" color={c.green} size={20} /><T weight="semi" style={{ flex: 1, fontSize: 12, lineHeight: 20 }}>Customer name + unpaid total added to Khata.</T></View>
      </Card>
      <T style={ui.help}>To test, send HI to your linked business number from another WhatsApp account. Keep the bot running on your computer for automatic replies.</T>
      <Pressable accessibilityRole="button" accessibilityLabel="Connection settings" onPress={() => setSettings((value) => !value)} style={{ alignSelf: 'center', padding: 10 }}><T style={{ fontSize: 11, color: c.muted }}>Connection settings {settings ? '⌃' : '⌄'}</T></Pressable>
      {settings && <Card style={{ gap: 13 }}>
        <T style={ui.help}>{connection.url}</T>
        <T style={ui.help}>Last incoming: {status?.lastIncomingAt ? new Date(status.lastIncomingAt).toLocaleTimeString() : 'Waiting for a customer message'}{ '\n' }Last reply: {status?.lastReplyAt ? new Date(status.lastReplyAt).toLocaleTimeString() : 'No reply sent this session'}</T>
        <T style={ui.help}>whatsapp-web.js is an unofficial prototype connection. WhatsApp may restrict unofficial clients. Stopping preserves the linked session.</T>
        {status && !['idle', 'disconnected'].includes(status.state) && <Button title="Stop WhatsApp replies" secondary disabled={busy} onPress={() => void run(async () => { await request('/api/whatsapp/stop', { method: 'POST' }); await refresh(); })} />}
        <Button title="Disconnect app from bot" secondary disabled={busy} onPress={() => void run(disconnect)} />
        <T style={ui.help}>Disconnecting this app stops sync. Stop WhatsApp replies first to stop the bot as well.</T>
      </Card>}
    </>}
  </Page>;
}
