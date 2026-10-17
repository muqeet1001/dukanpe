import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Badge, Button, Card, Field, Icon, Page, T, ui } from '../components/ui';
import { DemoResult, defaultBotUrl } from '../lib/bot-api';
import { money, parseAmount } from '../lib/domain';
import { useBusiness } from '../state/business';
import { useWhatsApp } from '../state/whatsapp';
import { colors as c } from '../theme';

const labels = { idle: 'Not linked', starting: 'Opening WhatsApp…', qr: 'Scan to link', authenticating: 'Signing in…', connected: 'WhatsApp linked', disconnected: 'Disconnected', error: 'Connection needs attention' };
export default function WhatsAppScreen() {
  const { connection, snapshot, error, pair, disconnect, refresh, request } = useWhatsApp();
  const { notify } = useBusiness();
  const [url, setUrl] = useState(defaultBotUrl);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [name, setName] = useState('Demo Customer');
  const [body, setBody] = useState('2 kg rice, 1 kg sugar');
  const [result, setResult] = useState<DemoResult | null>(null);
  const [productId, setProductId] = useState('');
  const [price, setPrice] = useState('');
  const command = useRef<{ content: string; id: string } | null>(null);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setProblem('');
    try { await work(); } catch (reason) { setProblem(reason instanceof Error ? reason.message : 'This action failed. Please try again.'); }
    finally { setBusy(false); }
  };
  const testOrder = () => run(async () => {
    if (!name.trim() || !body.trim()) throw new Error('Enter a demo customer and an order.');
    const content = name.trim() + '\n' + body.trim();
    // Retain the same ID after a network failure, so retrying cannot create a second debit.
    if (!command.current || command.current.content !== content) command.current = { content, id: 'demo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) };
    const response = await request<DemoResult>('/api/demo/order', { method: 'POST', body: { messageId: command.current.id, name: name.trim(), body: body.trim() } });
    setResult(response); await refresh();
    if (response.invoice) notify('Invoice created and added to demo customer khata');
  });
  const status = snapshot?.status;
  return <Page title="WhatsApp orders" subtitle="An order. An invoice. Your khata, updated." back>
    <Card style={{ backgroundColor: c.navy, borderColor: c.navy, gap: 14 }}>
      <View style={ui.between}><Icon name="logo-whatsapp" size={29} color="#8EDCF9" /><Badge label={connection ? 'SERVER PAIRED' : 'PAIR YOUR SERVER'} /></View>
      <T weight="extra" style={{ color: c.white, fontSize: 22 }}>Orders, straight to khata.</T>
      <T style={{ color: '#C7DEF3', fontSize: 12, lineHeight: 21 }}>Customers send a text order. Your saved prices become an unpaid invoice and a linked khata entry.</T>
    </Card>
    {!!(problem || error) && <Card style={{ backgroundColor: c.amberLight, gap: 7 }}><T accessibilityLiveRegion="polite" style={{ color: '#8E6112', fontSize: 12, lineHeight: 20 }}>{problem || error}</T></Card>}

    {!connection ? <Card style={{ gap: 15 }}>
      <T weight="extra" style={{ fontSize: 17 }}>Pair Dukanpe with the bot</T>
      <T style={ui.help}>Start the Node bot on your computer. Use its server address and private pairing code. Keep both devices on the same Wi-Fi.</T>
      <Field label="Bot server address" accessibilityLabel="Bot server address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="http://192.168.1.10:4000" />
      <Field label="Pairing code" accessibilityLabel="Bot pairing code" value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Paste the code from your bot server" />
      <Button title={busy ? 'Pairing…' : 'Pair bot server'} disabled={busy} onPress={() => void run(async () => { await pair(url, token); setToken(''); })} icon="link-outline" />
    </Card> : <>
      <Card style={{ gap: 14 }}>
        <View style={ui.between}><T weight="extra" style={{ fontSize: 17 }}>Link WhatsApp</T><Badge label={status ? labels[status.state] : 'Checking…'} tone={status?.state === 'connected' ? 'green' : 'blue'} /></View>
        <T style={ui.help}>{snapshot?.shopName} · {connection.url}</T>
        {status?.error && <T style={{ color: c.amber, fontSize: 11, lineHeight: 19 }}>{status.error}</T>}
        {status?.qr && <View style={{ alignItems: 'center', gap: 12 }}>
          <Image accessibilityLabel="WhatsApp account linking QR" source={{ uri: status.qr }} resizeMode="contain" style={{ width: 250, height: 250, backgroundColor: c.white }} />
          <T style={[ui.help, { textAlign: 'center' }]}>On your business phone: WhatsApp → Linked devices → Link a device. Scan this QR. It refreshes automatically.</T>
        </View>}
        {status?.state === 'connected' && <T style={{ fontSize: 12, lineHeight: 21, color: c.green }}>Ready for incoming text orders. Send MENU from another phone to see your catalogue.</T>}
        {!status || ['idle', 'error', 'disconnected'].includes(status.state)
          ? <Button title="Link WhatsApp" icon="qr-code-outline" disabled={busy} onPress={() => void run(async () => { await request('/api/whatsapp/stop', { method: 'POST' }); await request('/api/whatsapp/start', { method: 'POST' }); await refresh(); })} />
          : <Button title="Stop WhatsApp connection" secondary disabled={busy} onPress={() => void run(async () => { await request('/api/whatsapp/stop', { method: 'POST' }); await refresh(); })} />}
        <T style={ui.help}>Prototype using whatsapp-web.js. Use a test number; WhatsApp can restrict unofficial clients. Stop preserves the linked session on your computer.</T>
      </Card>

      <Card style={{ gap: 13 }}>
        <View style={ui.between}><T weight="extra" style={{ fontSize: 17 }}>Your prices</T><T style={{ fontSize: 10, color: c.muted }}>Tap to edit</T></View>
        <T style={ui.help}>These start as sample prices. Check them before taking real orders. Existing invoices keep the price used when they were issued.</T>
        {snapshot?.catalogue.map((product) => <Pressable accessibilityRole="button" accessibilityLabel={`Edit price for ${product.name}`} key={product.id} onPress={() => { setProductId(product.id); setPrice(String(product.pricePaise / 100)); }} style={[ui.between, { paddingVertical: 9, borderBottomColor: c.line, borderBottomWidth: 1 }]}>
          <T weight="semi" style={{ fontSize: 12 }}>{product.name}</T><T style={{ fontSize: 12, color: c.navy }}>{money(product.pricePaise)} / {product.unit}  <Icon name="create-outline" size={13} /></T>
        </Pressable>)}
        {!!productId && <View style={{ gap: 10 }}><Field label={`New price for ${snapshot?.catalogue.find((p) => p.id === productId)?.name}`} accessibilityLabel="Product price in rupees" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
          <Button title="Save price" disabled={busy} onPress={() => void run(async () => {
            const pricePaise = parseAmount(price); if (!pricePaise) throw new Error('Enter a valid positive price.');
            await request('/api/catalogue/' + productId, { method: 'PUT', body: { pricePaise } }); await refresh(); setProductId(''); notify('Price saved for future orders');
          })} /></View>}
      </Card>

      <Card style={{ gap: 14, backgroundColor: c.sky, borderColor: '#D2EAF7' }}>
        <View style={ui.between}><T weight="extra" style={{ fontSize: 17 }}>Try an order</T><Badge label="SIMULATED CHAT" /></View>
        <T style={ui.help}>This uses the same invoice and khata logic. No WhatsApp messages are sent, and the customer is kept separate from real contacts.</T>
        <Field label="Demo customer" accessibilityLabel="Demo customer name" value={name} onChangeText={(value) => { setName(value); setResult(null); }} maxLength={100} />
        <Field label="Customer message" accessibilityLabel="Demo WhatsApp order" value={body} onChangeText={(value) => { setBody(value); setResult(null); }} multiline maxLength={2000} style={{ minHeight: 80 }} />
        <Button title={busy ? 'Working…' : result?.invoice ? 'Check same order again' : 'Test order → invoice → khata'} icon="paper-plane-outline" disabled={busy} onPress={() => void testOrder()} />
        {result && <View style={{ backgroundColor: c.white, borderRadius: 13, padding: 14, gap: 13 }}>
          <T weight="bold" style={{ fontSize: 11, color: c.blue }}>BOT REPLY {result.duplicate ? '· SAME ORDER, NO EXTRA CHARGE' : ''}</T>
          <T selectable style={{ fontSize: 12, lineHeight: 21 }}>{result.reply}</T>
          {result.invoice && <Button title="Open invoice" secondary onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: result.invoice!.id } })} />}
        </View>}
      </Card>

      <Card style={{ gap: 12 }}><T weight="extra" style={{ fontSize: 17 }}>Latest invoices</T>
        {!snapshot?.invoices.length && <T style={ui.help}>Your first order will appear here and in customer khata.</T>}
        {snapshot?.invoices.slice(0, 8).map((invoice) => <Pressable accessibilityRole="button" key={invoice.id} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: invoice.id } })} style={[ui.between, { paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.line, gap: 10 }]}>
          <View style={{ flex: 1, gap: 5 }}><T weight="bold" style={{ fontSize: 12 }}>{invoice.customerName}</T><T style={{ fontSize: 9, color: c.muted }}>{invoice.number} · {invoice.isDemo ? 'Simulated' : invoice.delivery}</T></View><T weight="extra" style={{ fontSize: 16 }}>{money(invoice.totalPaise)}</T><Icon name="chevron-forward" size={15} />
        </Pressable>)}
      </Card>
      <Button title="Disconnect this app from bot" secondary disabled={busy} onPress={() => void run(disconnect)} />
      <T style={[ui.help, { textAlign: 'center' }]}>Disconnecting stops app sync. To stop automatic WhatsApp replies, use Stop WhatsApp connection first.</T>
    </>}
  </Page>;
}
