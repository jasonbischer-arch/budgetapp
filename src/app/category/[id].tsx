// The transactions behind one "Spending by category" row, for the same
// period as the Overview filter (this month, 3, 6 or 12 months).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card, Divider, ErrorText, IconBubble, Row, Screen, Segmented, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchCategories, fetchCategoryTransactions, useQuery } from '@/lib/data';
import { money, shortDate } from '@/lib/format';
import { monthStart } from '@/lib/insights';
import { categoryEmoji } from '@/lib/visuals';

type Period = '1' | '3' | '6' | '12';
const PERIODS: { value: Period; label: string }[] = [
  { value: '1', label: 'This month' },
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
];

export default function CategoryTransactions() {
  const c = useTheme();
  const params = useLocalSearchParams<{ id: string; months?: string }>();
  const categoryId = params.id === 'none' ? null : params.id;
  const [period, setPeriod] = useState<Period>(
    (['1', '3', '6', '12'] as const).find((p) => p === params.months) ?? '1',
  );

  const { data, loading, error, reload } = useQuery(
    async () => {
      const now = new Date();
      const [categories, rows] = await Promise.all([
        fetchCategories(),
        fetchCategoryTransactions({
          categoryId,
          from: monthStart(now, -(Number(period) - 1)),
          to: monthStart(now, 1),
        }),
      ]);
      return { category: categories.find((x) => x.id === categoryId) ?? null, rows };
    },
    { category: null, rows: [] },
    `${categoryId}:${period}`,
  );

  const cat = data.category;
  const total = -data.rows.reduce((s, r) => s + r.amount, 0);
  const months = Number(period);
  const name = cat?.name ?? 'Uncategorized';

  // Group by month, newest first.
  const groups = new Map<string, typeof data.rows>();
  for (const r of data.rows) {
    const m = r.date.slice(0, 7);
    groups.set(m, [...(groups.get(m) ?? []), r]);
  }

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: name }} />
      <Card>
        <Row style={{ gap: Spacing.sm }}>
          <IconBubble emoji={categoryEmoji(cat)} color={cat?.color ?? c.textMuted} size={44} />
          <View style={{ flexShrink: 1 }}>
            <T variant="heading">{name}</T>
            <T variant="small">
              {data.rows.length} transaction{data.rows.length === 1 ? '' : 's'}
              {months > 1 ? ` · ${money(total / months)} / month` : ''}
            </T>
          </View>
        </Row>
        <T variant="money" style={{ fontSize: 28, fontWeight: '800' }}>
          {money(total)}
        </T>
      </Card>
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      <ErrorText message={error} />

      {!loading && data.rows.length === 0 && (
        <Card>
          <T variant="muted">No {name.toLowerCase()} transactions in this period.</T>
        </Card>
      )}

      {[...groups.entries()].map(([month, rows]) => {
        const monthTotal = -rows.reduce((s, r) => s + r.amount, 0);
        const label = new Date(`${month}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        return (
          <Card key={month}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="small" style={{ fontWeight: '700' }}>
                {label.toUpperCase()}
              </T>
              <T variant="small" style={{ fontWeight: '700' }}>
                {money(monthTotal)}
              </T>
            </Row>
            {rows.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <Divider />}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${r.merchant || r.description}, ${shortDate(r.date)}, ${money(Math.abs(r.amount))}`}
                  onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: r.id } })}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: Spacing.xs })}>
                  <Row style={{ justifyContent: 'space-between', gap: Spacing.sm }}>
                    <View style={{ flexShrink: 1 }}>
                      <T numberOfLines={1}>{r.merchant || r.description}</T>
                      <T variant="small">{shortDate(r.date)}</T>
                    </View>
                    <T variant="money" color={r.amount > 0 ? c.positive : undefined}>
                      {r.amount > 0 ? `+${money(r.amount)}` : money(-r.amount)}
                    </T>
                  </Row>
                </Pressable>
              </View>
            ))}
          </Card>
        );
      })}
      {data.rows.length > 0 && (
        <T variant="small">Tap a transaction to change its category or exclude it.</T>
      )}
    </Screen>
  );
}
