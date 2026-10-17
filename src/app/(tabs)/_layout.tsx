import { Href, router, Tabs } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName, T } from '../../components/ui';
import { useBusiness } from '../../state/business';
import { colors as c } from '../../theme';

const tabs: Record<string, { label: string; icon: IconName; active: IconName; path: Href }> = {
  index: { label: 'Home', icon: 'home-outline', active: 'home', path: '/' },
  khata: { label: 'Khata', icon: 'book-outline', active: 'book', path: '/khata' },
  'follow-ups': { label: 'Follow-ups', icon: 'checkmark-done-outline', active: 'checkmark-done', path: '/follow-ups' },
  ask: { label: 'Ask', icon: 'sparkles-outline', active: 'sparkles', path: '/ask' },
};

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { state } = useBusiness();
  const tasks = state.followUps.filter((item) => item.status === 'open').length;
  return <Tabs screenOptions={{ headerShown: false, animation: 'fade' }} tabBar={({ state: navigation, descriptors }) =>
    <View style={{ flexDirection: 'row', paddingTop: 10, paddingBottom: Math.max(13, insets.bottom), paddingHorizontal: 10, backgroundColor: c.white, borderTopWidth: 1, borderTopColor: '#E7E7E7' }}>
      {navigation.routes.map((route, index) => {
        const selected = navigation.index === index;
        const tab = tabs[route.name];
        if (!tab) return null;
        const options = descriptors[route.key].options;
        return <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={options.title ?? tab.label}
          accessibilityState={{ selected }} onPress={() => {
            if (!selected) router.navigate(tab.path);
          }} style={{ flex: 1, alignItems: 'center', gap: 5 }}>
          <View style={{ width: 54, height: 32, borderRadius: 10, backgroundColor: selected ? '#EAF6FD' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={selected ? tab.active : tab.icon} size={23} color={selected ? c.navy : '#7A7A7A'} />
            {route.name === 'follow-ups' && tasks > 0 && <View style={{ position: 'absolute', top: -3, right: 5, backgroundColor: c.cyan, borderWidth: 2, borderColor: c.white, height: 16, minWidth: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}><T weight="extra" style={{ fontSize: 8, color: c.white }}>{tasks}</T></View>}
          </View>
          <T weight={selected ? 'bold' : 'medium'} style={{ fontSize: 11, color: selected ? c.navy : '#7A7A7A' }}>{tab.label}</T>
        </Pressable>;
      })}
    </View>}>
    <Tabs.Screen name="index" options={{ title: 'Home' }} />
    <Tabs.Screen name="khata" options={{ title: 'Khata' }} />
    <Tabs.Screen name="follow-ups" options={{ title: 'Follow-ups' }} />
    <Tabs.Screen name="ask" options={{ title: 'Ask' }} />
  </Tabs>;
}
