import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { T } from '../components/ui';
import { BusinessProvider, useBusiness } from '../state/business';
import { WhatsAppProvider } from '../state/whatsapp';
import { colors as c } from '../theme';

function AppShell() {
  const { ready, toast, storageError } = useBusiness();
  if (!ready) return <View style={styles.loading}><ActivityIndicator color={c.blue} /><T>Opening your shop…</T></View>;
  return <View style={styles.canvas}>
    <StatusBar style="dark" />
    {storageError && <View style={styles.warning}><T style={{ fontSize: 10 }}>{storageError}</T></View>}
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background }, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="entry" options={{ presentation: 'modal' }} />
      <Stack.Screen name="record/[id]" />
      <Stack.Screen name="customer/[id]" />
      <Stack.Screen name="follow-up/[id]" />
      <Stack.Screen name="records" />
      <Stack.Screen name="sources" />
      <Stack.Screen name="whatsapp" />
      <Stack.Screen name="invoice/[id]" />
    </Stack>
    {toast && <View pointerEvents="none" accessibilityLiveRegion="polite" style={styles.toast}><T weight="semi" style={{ color: c.white, fontSize: 12 }}>{toast}</T></View>}
  </View>;
}

export default function RootLayout() {
  return <SafeAreaProvider><View style={styles.outer}><BusinessProvider><WhatsAppProvider><AppShell /></WhatsAppProvider></BusinessProvider></View></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  outer: { flex: 1, alignItems: 'center', backgroundColor: '#E6EFF7' },
  canvas: { flex: 1, width: '100%', maxWidth: 480, backgroundColor: c.background, overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 80px rgba(14, 54, 94, 0.08)' } : {}) },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 15 },
  warning: { padding: 10, backgroundColor: c.amberLight },
  toast: { position: 'absolute', bottom: 105, alignSelf: 'center', backgroundColor: c.navy, maxWidth: '90%', paddingHorizontal: 20, paddingVertical: 15, borderRadius: 15, zIndex: 100 },
});
