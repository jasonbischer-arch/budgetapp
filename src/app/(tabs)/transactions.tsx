import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { MonthPicker, useMonth } from '@/components/month-picker';
import { Card, Divider, ErrorText, IconBubble, Input, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { categoryEmoji } from '@/lib/visuals';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchAccounts,
  fetchCategories,
  fetchTransactions,
  monthRange,
  useQuery,
} from '@/lib/data';
import { money, shortDate } from '@/lib/format';

export default function Transactions() {
  const c = useTheme();
  const month = useMonth();
  const range = monthRange(month.year, month.index);
  const [search, setSearch] = useState('');

  const { data, loading, error, reload } = useQuery(
    async () => {
      const [txns, categories, accounts] = await Promise.all([
        fetchTransactions(range),
        fetchCategories(),
        fetchAccounts(),
      ]);
      return { txns, categories, accounts };
    },
    { txns: [], categories: [], accounts: [] },
    range.from,
  );

  const catById = useMemo(() => new Map(data.categories.map((x) => [x.id, x])), [data.categories]);
  const acctById = useMemo(() => new Map(data.accounts.map((x) => [x.id, x])), [data.accounts]);
  const hiddenAccounts = useMemo(
    () => new Set(data.accounts.filter((a) => a.hidden).map((a) => a.id)),
    [data.accounts],
  );

  const q = search.trim().toLowerCase();
  const rows = data.txns.filter(
    (t) =>
      !hiddenAccounts.has(t.account_id) &&
      (!q ||
        t.description.toLowerCase().includes(q) ||
        (t.merchant ?? '').toLowerCase().includes(q) ||
        (catById.get(t.category_id ?? '')?.name ?? '').toLowerCase().includes(q)),
  );

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <T variant="title">Transactions</T>
      <MonthPicker month={month} />
      <Input placeholder="Search" value={search} onChangeText={setSearch} autoCorrect={false} />
      <ErrorText message={error} />
      <Card style={{ paddingVertical: 4 }}>
        {rows.length === 0 && (
          <T variant="muted" style={{ paddingVertical: 12 }}>
            {loading ? 'Loading…' : 'No transactions.'}
          </T>
        )}
        {rows.map((t, i) => {
          const cat = t.category_id ? catById.get(t.category_id) : undefined;
          const acct = acctById.get(t.account_id);
          return (
            <View key={t.id}>
              {i > 0 && <Divider />}
              <Pressable
                onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: t.id } })}
                style={({ pressed }) => [{ paddingVertical: 10 }, pressed && { opacity: 0.6 }]}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row style={{ gap: Spacing.sm, flexShrink: 1 }}>
                    <IconBubble emoji={categoryEmoji(cat)} color={cat?.color ?? c.textMuted} />
                    <View style={{ flexShrink: 1, gap: 2 }}>
                      <T numberOfLines={1} style={t.excluded ? { opacity: 0.5 } : undefined}>
                        {t.merchant || t.description}
                      </T>
                      <Row style={{ gap: 6 }}>
                        <T variant="small" numberOfLines={1}>
                          {cat?.name ?? 'Uncategorized'} · {shortDate(t.date)}
                          {acct ? ` · ${acct.name}` : ''}
                          {t.status === 'pending' ? ' · Pending' : ''}
                          {t.excluded ? ' · Excluded' : ''}
                        </T>
                      </Row>
                    </View>
                  </Row>
                  <T variant="money" color={t.amount > 0 ? c.positive : undefined}>
                    {t.amount > 0 ? '+' : ''}
                    {money(t.amount)}
                  </T>
                </Row>
              </Pressable>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}
