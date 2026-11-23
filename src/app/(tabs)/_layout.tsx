import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type IconName = { ios: string; android: string; web: string };

function icon(name: IconName) {
  return ({ color }: { color: ColorValue }) => (
    <SymbolView name={name as never} tintColor={color as string} size={22} />
  );
}

export default function TabsLayout() {
  const c = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Overview',
          tabBarIcon: icon({ ios: 'chart.pie.fill', android: 'pie_chart', web: 'pie_chart' }),
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarIcon: icon({ ios: 'list.bullet', android: 'list', web: 'list' }),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Plan',
          tabBarIcon: icon({ ios: 'calendar', android: 'event', web: 'event' }),
        }}
      />
      <Tabs.Screen
        name="accounts"
        options={{
          title: 'Accounts',
          tabBarIcon: icon({ ios: 'building.columns.fill', android: 'account_balance', web: 'account_balance' }),
        }}
      />
    </Tabs>
  );
}
