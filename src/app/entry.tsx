import { router, useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Button, Card, Chip, Field, Icon, Page, T, ui } from '../components/ui';
import { money, parseAmount } from '../lib/domain';
import { useBusiness } from '../state/business';
import { colors as c, fonts as f } from '../theme';

export default function EntryScreen() {
  const params = useLocalSearchParams<{ mode?: string; partyId?: string }>();
  const { state, dispatch, notify } = useBusiness();
  const [paid, setPaid] = useState(params.mode !== 'credit');
  const [partyId, setPartyId] = useState(params.partyId ?? '');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const commandId = useRef<string | null>(null);
  const parsed = parseAmount(amount);
  const save = () => {
    if (saved) return;
    if (!parsed) return setError('Enter a valid amount, such as 200 or 200.50.');
    if (!paid && !partyId) return setError('Choose a customer for an udhaar entry.');
    if (!description.trim()) return setError('Add a short description of the sale.');
    commandId.current ??= 'sale-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    setSaved(true);
    dispatch({ type: 'add-sale', input: { id: commandId.current, partyId: partyId || undefined, amountPaise: parsed, description, paid, createdAt: new Date().toISOString() } });
    notify(paid ? 'Sale and cash receipt recorded' : 'Udhaar added to customer khata');
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Page title={paid ? 'Record a sale' : 'Add udhaar'} subtitle="A quick entry. A clear record." back>
      <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 12, backgroundColor: c.sky, borderColor: '#DDF0FB' }}>
        <T weight="bold" style={{ color: '#6A8BA5', fontSize: 11 }}>SALE AMOUNT</T>
        <Field value={amount} onChangeText={(text) => { setAmount(text); setError(''); }} accessibilityLabel="Sale amount in rupees" placeholder="₹0" keyboardType="decimal-pad"
          maxLength={12} style={{ backgroundColor: 'transparent', borderWidth: 0, fontSize: 44, fontFamily: f.extra, textAlign: 'center', padding: 2, minWidth: 200, color: c.navy }} />
        <T style={{ color: c.muted, fontSize: 10 }}>Indian rupees · INR</T>
      </Card>
      <View style={{ gap: 10 }}><T weight="bold" style={{ fontSize: 12 }}>How was it paid?</T><View style={{ flexDirection: 'row', gap: 10 }}>
        <Chip label="Paid · Cash" active={paid} onPress={() => { setPaid(true); setError(''); }} />
        <Chip label="Udhaar · Pay later" active={!paid} onPress={() => { setPaid(false); setError(''); }} />
      </View></View>
      <View style={{ gap: 10 }}><T weight="bold" style={{ fontSize: 12 }}>Customer {!paid ? '· Required for udhaar' : '· Optional'}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
          {paid && <Chip label="Walk-in" active={!partyId} onPress={() => setPartyId('')} />}
          {state.parties.map((party) => <Chip key={party.id} label={party.name.split(' ')[0]} active={partyId === party.id} onPress={() => { setPartyId(party.id); setError(''); }} />)}
        </View>
      </View>
      <Field label="What did you sell?" accessibilityLabel="Sale description" placeholder="e.g. 2 kg atta, oil and groceries" value={description} onChangeText={setDescription} multiline maxLength={180} style={{ minHeight: 85, textAlignVertical: 'top' }} />
      <Card style={{ gap: 11 }}>
        <View style={ui.between}><T style={{ fontSize: 12, color: c.muted }}>Sale total</T><T weight="extra" style={{ fontSize: 19 }}>{money(parsed ?? 0)}</T></View>
        <View style={{ height: 1, backgroundColor: c.line }} />
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}><Icon name={paid ? 'checkmark-circle-outline' : 'book-outline'} color={c.blue} size={18} />
          <T style={[ui.help, { flex: 1 }]}>{paid ? 'Records one sale and one merchant-recorded cash receipt. Customer dues stay unchanged.' : 'Records a credit sale and adds its amount to the selected customer’s khata.'}</T></View>
      </Card>
      {!!error && <T accessibilityLiveRegion="polite" style={{ fontSize: 12, color: '#B95B4D' }}>{error}</T>}
      <Button title={paid ? 'Save sale' : 'Save udhaar entry'} icon="checkmark-outline" onPress={save} disabled={saved} />
      <T style={[ui.help, { textAlign: 'center' }]}>This demo saves entries on this device.</T>
    </Page>
  </KeyboardAvoidingView>;
}
