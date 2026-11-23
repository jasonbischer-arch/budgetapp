import { router } from 'expo-router';
import { View } from 'react-native';

import { MonthPicker, useMonth } from '@/components/month-picker';
import { Button, Card, Divider, ErrorText, ProgressBar, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  fetchAccounts,
  fetchCategories,
  fetchTransactions,
  monthRange,
  summarize,
  useQuery,
} from '@/lib/data';
import { money, moneyWhole } from '@/lib/format';

export default function Overview() {
  const c = useTheme();
  const { household } = useAuth();
  const month = useMonth();
  const range = monthRange(month.year, month.index);

  const { data, loading, error, reload } = useQuery(
    async () => {
      const [accounts, categories, txns] = await Promise.all([
        fetchAccounts(),
        fetchCategories(),
        fetchTransactions(range),
      ]);
      return { accounts, categories, txns };
    },
    { accounts: [], categories: [], txns: [] },
    range.from,
  );

  const visible = data.accounts.filter((a) => !a.hidden);
  const cash = visible
    .filter((a) => a.type === 'depository')
    .reduce((s, a) => s + (a.balance_available ?? a.balance_ledger ?? 0), 0);
  const owed = visible
    .filter((a) => a.type === 'credit')
    .reduce((s, a) => s + (a.balance_ledger ?? 0), 0);

  const { income, spent, spentByCategory } = summarize(data.txns, data.categories);
  const net = income - spent;

  const budgeted = data.categories
    .filter((cat) => !cat.is_income && (cat.monthly_budget || spentByCategory.get(cat.id)))
    .map((cat) => ({ cat, spent: spentByCategory.get(cat.id) ?? 0 }))
    .sort((a, b) => b.spent - a.spent);
  const uncategorized = spentByCategory.get(null) ?? 0;

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <T variant="muted">{household?.name}</T>

      {data.accounts.length === 0 && !loading ? (
        <Card>
          <T variant="heading">Connect your first bank</T>
          <T variant="muted">Link your checking, savings and credit cards to start tracking.</T>
          <Button title="Connect a bank" onPress={() => router.push('/accounts')} />
        </Card>
      ) : (
        <Row style={{ gap: Spacing.md }}>
          <Stat label="Cash" value={moneyWhole(cash)} />
          <Stat label="Card balances" value={moneyWhole(owed)} />
        </Row>
      )}

      <MonthPicker month={month} />
      <ErrorText message={error} />

      <Row style={{ gap: Spacing.md }}>
        <Stat label="Income" value={moneyWhole(income)} color={c.positive} />
        <Stat label="Spent" value={moneyWhole(spent)} />
        <Stat label="Net" value={moneyWhole(net)} color={net >= 0 ? c.positive : c.negative} />
      </Row>

      <Card>
        <T variant="heading">Spending by category</T>
        {budgeted.length === 0 && uncategorized === 0 && (
          <T variant="muted">No spending yet this month.</T>
        )}
        {budgeted.map(({ cat, spent: s }, i) => {
          const budget = cat.monthly_budget ?? 0;
          const over = budget > 0 && s > budget;
          return (
            <View key={cat.id} style={{ gap: 6 }}>
              {i > 0 && <Divider />}
              <Row style={{ justifyContent: 'space-between', marginTop: i > 0 ? 8 : 0 }}>
                <Row style={{ gap: 8, flexShrink: 1 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cat.color }} />
                  <T numberOfLines={1}>{cat.name}</T>
                </Row>
                <T variant="money" color={over ? c.negative : undefined}>
                  {money(s)}
                  {budget > 0 && <T variant="small"> / {moneyWhole(budget)}</T>}
                </T>
              </Row>
              {budget > 0 && (
                <ProgressBar value={s / budget} color={over ? c.negative : cat.color} />
              )}
            </View>
          );
        })}
        {uncategorized > 0 && (
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="muted">Uncategorized</T>
            <T variant="money">{money(uncategorized)}</T>
          </Row>
        )}
      </Card>
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card style={{ flex: 1, gap: 4, padding: Spacing.md }}>
      <T variant="small">{label}</T>
      <T variant="money" color={color} style={{ fontSize: 18 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
    </Card>
  );
}
