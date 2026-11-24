// Add a fixed (or variable) expense from what you've actually paid: payees
// from the last 6 months that aren't a bill yet, recurring ones first.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Badge, Button, Card, Divider, ErrorText, IconBubble, Input, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchBills, fetchCategories, fetchSpendingSince, useQuery } from '@/lib/data';
import { money, ordinal, shortDate } from '@/lib/format';
import { monthStart, PayeeGroup, payeesToAdd } from '@/lib/insights';
import { categoryEmoji } from '@/lib/visuals';

export default function PickExpense() {
  const c = useTheme();
  const { type } = useLocalSearchParams<{ type?: string }>();
  const side = type === 'variable' ? 'variable' : 'fixed';
  const [search, setSearch] = useState('');

  const { data, loading, error, reload } = useQuery(
    async () => {
      const [rows, bills, categories] = await Promise.all([
        fetchSpendingSince(monthStart(new Date(), -6)),
        fetchBills(),
        fetchCategories(),
      ]);
      return { payees: payeesToAdd(rows, bills), categories };
    },
    { payees: [] as PayeeGroup[], categories: [] as Awaited<ReturnType<typeof fetchCategories>> },
  );

  const q = search.trim().toLowerCase();
  const shown = data.payees.filter((p) => !q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q));
  const recurring = shown.filter((p) => p.recurring);
  const others = shown.filter((p) => !p.recurring).slice(0, q ? 100 : 40);

  function pick(p: PayeeGroup) {
    // Replace this screen, so saving the bill returns to the expenses list.
    router.replace({
      pathname: '/bill/[id]',
      params: {
        id: 'new',
        type: side,
        name: p.name,
        amount: String(p.recurring ? p.typical : p.lastAmount),
        day: String(p.day),
        categoryId: p.categoryId ?? '',
      },
    });
  }

  const PayeeRow = ({ p }: { p: PayeeGroup }) => {
    const cat = data.categories.find((x) => x.id === p.categoryId);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${p.name}, ${money(p.recurring ? p.typical : p.lastAmount)}`}
        onPress={() => pick(p)}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: Spacing.xs })}>
        <Row style={{ justifyContent: 'space-between', gap: Spacing.sm }}>
          <Row style={{ gap: Spacing.sm, flexShrink: 1 }}>
            <IconBubble emoji={categoryEmoji(cat)} color={cat?.color ?? c.textMuted} size={34} />
            <View style={{ flexShrink: 1 }}>
              <T numberOfLines={1}>{p.name}</T>
              <T variant="small" numberOfLines={2}>
                {p.recurring
                  ? `Paid ${p.months} months · usually around the ${ordinal(p.day)}`
                  : `Paid ${shortDate(p.lastDate)}`}
                {cat ? ` · ${cat.name}` : ''}
              </T>
            </View>
          </Row>
          <View style={{ alignItems: 'flex-end' }}>
            <T variant="money">{money(p.recurring ? p.typical : p.lastAmount)}</T>
            <T variant="small" color={c.primary}>
              ＋ Add
            </T>
          </View>
        </Row>
      </Pressable>
    );
  };

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: side === 'fixed' ? 'Add a fixed expense' : 'Add a variable expense' }} />
      <T variant="muted">
        Pick a payment from your bank activity. Only ones that aren&apos;t already a bill are listed. You can adjust
        the amount and due date next.
      </T>
      <Input placeholder="Search payments" value={search} onChangeText={setSearch} autoCorrect={false} />
      <ErrorText message={error} />

      <Card>
        <Row style={{ gap: Spacing.sm }}>
          <T variant="heading">Paid every month</T>
          <Badge text="best matches" tone="primary" />
        </Row>
        {!loading && recurring.length === 0 && (
          <T variant="muted">{q ? 'No matches.' : 'Every regular payment is already a bill.'}</T>
        )}
        {recurring.map((p, i) => (
          <View key={p.key}>
            {i > 0 && <Divider />}
            <PayeeRow p={p} />
          </View>
        ))}
      </Card>

      <Card>
        <T variant="heading">Other recent payments</T>
        {!loading && others.length === 0 && <T variant="muted">{q ? 'No matches.' : 'Nothing else.'}</T>}
        {others.map((p, i) => (
          <View key={p.key}>
            {i > 0 && <Divider />}
            <PayeeRow p={p} />
          </View>
        ))}
      </Card>

      <Button
        title="Enter one by hand instead"
        kind="secondary"
        onPress={() => router.replace({ pathname: '/bill/[id]', params: { id: 'new', type: side } })}
      />
    </Screen>
  );
}
