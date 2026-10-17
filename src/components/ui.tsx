import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Image, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, TextProps, TextStyle, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BusinessRecord, Source, money } from '../lib/domain';
import { colors as c, fonts as f } from '../theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, size = 22, color = c.navy }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}
const brandAssets = {
  PhonePe: require('../../assets/phonepe.png'),
  GPay: require('../../assets/gpay.png'),
  WhatsApp: require('../../assets/whatsapp.png'),
};
export function BrandLogo({ brand, size = 36 }: { brand: keyof typeof brandAssets; size?: number }) {
  return <Image source={brandAssets[brand]} accessibilityLabel={brand}
    resizeMode="contain" style={{ height: size, width: size, borderRadius: size * 0.23 }} />;
}
export function AppWordmark() {
  return <T weight="extra" accessibilityLabel="Dukanpe" style={{ fontSize: 28, letterSpacing: -1.2, color: c.navy }}>Dukan<T weight="extra" style={{ fontSize: 28, color: c.cyan }}>pe</T></T>;
}
export function ServiceIcon({ name, size = 48 }: { name: IconName; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.navy, alignItems: 'center', justifyContent: 'center' }}>
    <Icon name={name} size={size * 0.5} color={c.white} />
  </View>;
}
export function T({ style, weight = 'regular', ...props }: TextProps & { weight?: keyof typeof f }) {
  const fontWeight = { regular: '400', medium: '500', semi: '600', bold: '700', extra: '800' }[weight] as TextStyle['fontWeight'];
  return <Text {...props} style={[{ fontFamily: f[weight], fontWeight, color: c.text, fontSize: 14 }, style]} />;
}
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[ui.card, style]}>{children}</View>;
}
export function IconButton({ name, onPress, label, style, color, disabled = false }: { name: IconName; onPress: () => void; label: string; style?: StyleProp<ViewStyle>; color?: string; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [ui.iconButton, style, pressed && { opacity: 0.65 }]}>
    <Icon name={name} color={color} />
  </Pressable>;
}
export function Button({ title, onPress, icon, secondary = false, disabled = false, style }: {
  title: string; onPress: () => void; icon?: IconName; secondary?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [ui.button, secondary && ui.buttonSecondary, style, (pressed || disabled) && { opacity: 0.55 }]}>
    {icon && <Icon name={icon} size={19} color={secondary ? c.navy : c.white} />}
    <T weight="bold" style={{ color: secondary ? c.navy : c.white, fontSize: 13 }}>{title}</T>
  </Pressable>;
}
export function Badge({ label, tone = 'blue' }: { label: string; tone?: 'blue' | 'green' | 'amber' | 'gray' }) {
  const palette = { blue: [c.sky, c.blue], green: [c.greenLight, c.green], amber: [c.amberLight, c.amber], gray: ['#EEF2F6', c.muted] }[tone];
  return <View style={[ui.badge, { backgroundColor: palette[0] }]}><T weight="bold" style={{ fontSize: 10, color: palette[1] }}>{label}</T></View>;
}
export function Section({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return <View style={ui.sectionHeader}><T weight="extra" style={{ fontSize: 18, letterSpacing: -0.5 }}>{title}</T>
    {action && (onPress ? <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10}><T weight="bold" style={{ color: c.blue, fontSize: 12 }}>{action}</T></Pressable>
      : <T weight="semi" style={{ color: c.muted, fontSize: 12 }}>{action}</T>)}
  </View>;
}
export function Field({ label, style, ...props }: TextInputProps & { label?: string }) {
  return <View style={{ gap: 8 }}>
    {label && <T weight="bold" style={{ fontSize: 12 }}>{label}</T>}
    <TextInput {...props} placeholderTextColor={c.muted} style={[ui.input, style]} />
  </View>;
}
export function SearchField({ value, onChangeText, placeholder = 'Search records', style, autoFocus = false }: { value: string; onChangeText: (text: string) => void; placeholder?: string; style?: StyleProp<ViewStyle>; autoFocus?: boolean }) {
  return <View style={[ui.searchField, style]}><Icon name="search-outline" size={20} color={c.muted} />
    <TextInput accessibilityLabel={placeholder} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={c.muted} autoFocus={autoFocus} returnKeyType="search"
      style={{ flex: 1, fontFamily: f.medium, color: c.navy, fontSize: 13, paddingVertical: 12, minWidth: 0 }} />
    {value.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} hitSlop={10}><Icon name="close-circle" size={18} color={c.muted} /></Pressable>}
  </View>;
}
export function Chip({ label, active, onPress, count }: { label: string; active: boolean; onPress: () => void; count?: number }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[ui.chip, active && { backgroundColor: c.navy, borderColor: c.navy }]}>
    <T weight="bold" style={{ fontSize: 11, color: active ? c.white : c.muted }}>{label}{count !== undefined ? '  ' + count : ''}</T>
  </Pressable>;
}
export function Avatar({ initials, tone = 'blue', size = 46 }: { initials: string; tone?: string; size?: number }) {
  const bg = { blue: '#E7F4FF', pink: '#FBEAF2', mint: '#E6F7EF', peach: '#FFF0E3' }[tone] ?? c.sky;
  const fg = { blue: '#1689D4', pink: '#BA6B90', mint: '#289B7D', peach: '#BF8A4C' }[tone] ?? c.blue;
  return <View style={{ height: size, width: size, borderRadius: size * 0.34, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
    <T weight="extra" style={{ color: fg, fontSize: size * 0.3 }}>{initials}</T>
  </View>;
}
export function SourceIcon({ source, size = 42 }: { source: Source; size?: number }) {
  if (source === 'PhonePe' || source === 'GPay' || source === 'WhatsApp') {
    return <View style={{ height: size, width: size, borderRadius: 12, overflow: 'hidden', backgroundColor: c.white, alignItems: 'center', justifyContent: 'center' }}><BrandLogo brand={source} size={size - 4} /></View>;
  }
  const definitions: Record<Source, { name: IconName; bg: string; color: string }> = {
    WhatsApp: { name: 'logo-whatsapp', bg: '#E5F8EB', color: '#25AA63' },
    PhonePe: { name: 'arrow-down-outline', bg: '#F0ECFD', color: '#7450BD' },
    GPay: { name: 'arrow-down-outline', bg: '#E9F3FF', color: '#3984D7' },
    Bill: { name: 'document-text-outline', bg: '#E7F6FE', color: c.blue },
    Manual: { name: 'storefront-outline', bg: c.sky, color: c.blue },
  };
  const item = definitions[source];
  return <View style={{ height: size, width: size, borderRadius: 14, backgroundColor: item.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={item.name} size={size * 0.49} color={item.color} /></View>;
}
export function RecordRow({ record, last = false }: { record: BusinessRecord; last?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/record/[id]', params: { id: record.id } })}
    style={({ pressed }) => [ui.recordRow, !last && { borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { backgroundColor: c.ice }]}>
    <SourceIcon source={record.source} />
    <View style={{ flex: 1, gap: 5 }}>
      <T weight="bold" numberOfLines={1} style={{ fontSize: 12 }}>{record.title}</T>
      <T numberOfLines={1} style={{ fontSize: 10, color: c.muted }}>{record.subtitle}</T>
    </View>
    <View style={{ alignItems: 'flex-end', gap: 5 }}>
      {record.amountPaise !== undefined && <T weight="extra" style={{ fontSize: 14 }}>{record.kind === 'receipt' ? '+' : ''}{money(record.amountPaise)}</T>}
      {record.status === 'review' ? <Badge label="Review" tone="amber" /> : record.status === 'open'
        ? <Badge label="Open" tone="gray" /> : record.status === 'confirmed' ? <T style={{ fontSize: 9, color: c.green }}>Confirmed</T> : <Badge label="Saved" />}
    </View>
  </Pressable>;
}
export function Page({ title, subtitle, children, right, scroll = true, back = false }: {
  title?: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode; scroll?: boolean; back?: boolean;
}) {
  const content = <>{title && <View style={ui.pageHeader}>{back && <IconButton name="arrow-back-outline" label="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ backgroundColor: c.white, marginRight: 10 }} />}
    <View style={{ flex: 1, gap: 6 }}><T weight="extra" style={{ fontSize: 27, letterSpacing: -1 }}>{title}</T>
      {subtitle && <T style={{ color: c.muted, fontSize: 12 }}>{subtitle}</T>}</View>{right}</View>}{children}</>;
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.background }}>
    {scroll ? <ScrollView contentContainerStyle={ui.pageContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{content}</ScrollView>
      : <View style={[ui.pageContent, { flex: 1 }]}>{content}</View>}
  </SafeAreaView>;
}
export function Empty({ title, description, icon = 'file-tray-outline' }: { title: string; description: string; icon?: IconName }) {
  return <View style={{ alignItems: 'center', padding: 32, gap: 12 }}><View style={{ backgroundColor: c.sky, borderRadius: 22, padding: 18 }}><Icon name={icon} size={30} color={c.blue} /></View>
    <T weight="bold" style={{ textAlign: 'center' }}>{title}</T><T style={{ textAlign: 'center', color: c.muted, fontSize: 12, lineHeight: 20 }}>{description}</T></View>;
}
export function Divider() { return <View style={{ height: 1, backgroundColor: c.line }} />; }
export const ui = StyleSheet.create({
  card: { backgroundColor: c.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F0F0F0' },
  iconButton: { width: 44, height: 44, borderRadius: 16, backgroundColor: c.ice, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 48, borderRadius: 10, paddingHorizontal: 18, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.navy },
  buttonSecondary: { backgroundColor: c.sky },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  input: { backgroundColor: c.white, borderColor: '#E1E1E1', borderWidth: 1, borderRadius: 10, padding: 15, fontFamily: f.medium, fontWeight: '500', fontSize: 14, color: c.text, minHeight: 50 },
  searchField: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 15, backgroundColor: c.white, borderRadius: 15, borderWidth: 1, borderColor: c.line, minHeight: 48 },
  chip: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.white },
  recordRow: { flexDirection: 'row', gap: 11, paddingVertical: 15, alignItems: 'center' },
  pageHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 5, marginBottom: 25 },
  pageContent: { padding: 16, paddingBottom: 30, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  help: { fontSize: 11, color: c.muted, lineHeight: 18 },
});
