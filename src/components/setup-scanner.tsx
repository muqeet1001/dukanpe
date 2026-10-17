import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { colors as c } from '../theme';
import { Button, Card, Page, T, ui } from './ui';

export function SetupScanner({ onScan, onClose }: { onScan: (data: string) => Promise<void>; onClose: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false); const locked = useRef(false);
  const read = async ({ data }: { data: string }) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setProblem('');
    try { await onScan(data); onClose(); }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : 'Setup failed.'); }
    finally { setBusy(false); }
  };
  return <Page title="Scan setup QR" subtitle="Point at the Dukanpe QR on your computer.">
    {!permission ? <ActivityIndicator color={c.blue} /> : permission.granted ? <View style={{ height: 340, borderRadius: 22, overflow: 'hidden', backgroundColor: c.navy }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={busy || problem ? undefined : (result) => void read(result)} />
    </View> : <Card style={{ gap: 15 }}><T style={ui.help}>Camera access lets you scan your shop setup QR. No photo is saved.</T>
      {permission.canAskAgain ? <Button title="Allow camera" onPress={() => void requestPermission()} /> : <T style={ui.help}>Enable camera access for Expo Go in your phone settings, or use manual pairing.</T>}
    </Card>}
    {busy && <T style={ui.help}>Connecting your shop…</T>}
    {!!problem && <Card style={{ gap: 15, backgroundColor: c.amberLight }}><T accessibilityLiveRegion="polite" style={ui.help}>{problem}</T><Button title="Scan again" disabled={busy} onPress={() => { locked.current = false; setProblem(''); }} /></Card>}
    <T style={ui.help}>On the computer, open WhatsApp connection → Connect phone app → Show setup QR. Both devices need the same Wi-Fi.</T>
    <Button title="Cancel scan" secondary onPress={onClose} />
  </Page>;
}
