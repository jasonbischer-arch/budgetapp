// Fixed or variable expenses, item by item: edit, add, remove, or move an
// expense to the other side.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Divider, ErrorText, IconBubble, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { Bill, deleteBill, setBillExpenseType } from '@/lib/data';
import { duration, money, moneyWhole, monthYear, ordinal } from '@/lib/format';
import { debtDetails, expenseBills, useHouseholdData } from '@/lib/household-data';
import { expenseBreakdown, ExpenseItem, trailingMonths } from '@/lib/insights';
import { billEmoji, categoryEmoji } from '@/lib/visuals';

type Side = 'fixed' | 'variable';

const COPY: Record<Side, { title: string; icon: string; accent: string; about: string; other: string }> = {
  fixed: {
    title: 'Fixed expenses',
    icon: '📌',
    accent: '#6250D6',
    about: 'The same every month: rent or mortgage, loans, insurance, subscriptions.',
    other: 'variable',
  },
  variable: {
    title: 'Variable expenses',
    icon: '🛒',
    accent: '#EDA100',
    about: 'Changes month to month: groceries, dining, gas, shopping.',
    other: 'fixed',
  },
};

export default function ExpensesSheet() {
  const c = useTheme();
  const { type } = useLocalSearchParams<{ type: string }>();
  const side: Side = type === 'variable' ? 'variable' : 'fixed';
  const copy = COPY[side];
  const other = copy.other as Side;
  const { data, loading, error, reload } = useHouseholdData();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const months = trailingMonths(new Date(), data.firstDate);
  const split = expenseBreakdown(
    data.flows,
    data.categories,
    months,
    expenseBills(data.bills, data.accounts, data.liabilities),
  );
  const list = split[side];
  const bills = list.items.filter((i) => i.kind === 'bill');
  // Variable also counts what you spend by category (groceries, dining...).
  const spending = list.items.filter((i) => i.kind === 'category');

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function move(item: ExpenseItem) {
    if (item.kind === 'bill') run(`move:${item.kind}:${item.id}`, () => setBillExpenseType(item.id!, other));
  }

  function remove(item: ExpenseItem) {
    const bill = data.bills.find((b) => b.id === item.id);
    if (!bill) return;
    confirmAction(
      `Remove ${bill.name}?`,
      bill.detection_key
        ? 'It was found in your bank activity; it won’t be added back.'
        : 'It will be removed from your bills and paycheck plan.',
      'Remove',
      () => run(`remove:${bill.id}`, () => deleteBill(bill)),
    );
  }

  /** For loans: what's left and when it's paid off. */
  const payoffText = (bill: Bill) => {
    if (!bill.is_debt) return '';
    const d = debtDetails(bill, data.accounts, data.liabilities);
    if (d.balance == null) return ' · add the balance to see the payoff date';
    if (!d.payoff) return ` · ${moneyWhole(d.balance)} left`;
    if (d.payoff.months == null) return ` · ${moneyWhole(d.balance)} left · payment doesn't cover interest`;
    return ` · ${moneyWhole(d.balance)} left · paid off ${monthYear(d.payoff.payoffDate!)} (${duration(d.payoff.months)})`;
  };

  const ItemRow = ({ item }: { item: ExpenseItem }) => {
    const bill = item.kind === 'bill' ? data.bills.find((b) => b.id === item.id) : undefined;
    const cat = item.kind === 'category' && item.id ? data.categories.find((x) => x.id === item.id) : undefined;
    const emoji = bill ? billEmoji(bill) : categoryEmoji(cat);
    return (
      <View style={{ gap: Spacing.sm }}>
        <Row style={{ justifyContent: 'space-between', gap: Spacing.sm }}>
          <Row style={{ gap: Spacing.sm, flexShrink: 1 }}>
            <IconBubble emoji={emoji} color={cat?.color ?? copy.accent} size={32} />
            <View style={{ flexShrink: 1 }}>
              <T numberOfLines={1}>{item.name}</T>
              <T variant="small">
                {bill
                  ? (bill.frequency === 'monthly'
                      ? `Due on the ${ordinal(bill.due_day)}`
                      : `${bill.frequency}, ${money(bill.amount ?? 0)} each`) + payoffText(bill)
                  : item.budgeted
                    ? `Your budget · you average ${money(item.average ?? 0)}`
                    : 'Monthly average from your bank activity'}
              </T>
            </View>
          </Row>
          <T variant="money">{money(item.monthly)}</T>
        </Row>
        <Row style={{ gap: Spacing.xs, flexWrap: 'wrap' }}>
          {bill && (
            <Button
              title="Edit"
              kind="secondary"
              onPress={() => router.push({ pathname: '/bill/[id]', params: { id: bill.id } })}
            />
          )}
          {!bill && (
            <Button
              title="Transactions"
              kind="secondary"
              onPress={() =>
                router.push({
                  pathname: '/category/[id]',
                  params: { id: item.id ?? 'none', months: '12', withoutBills: '1' },
                })
              }
            />
          )}
          {bill && (
            <Button
              title={`Move to ${other}`}
              kind="secondary"
              loading={busy === `move:${item.kind}:${item.id}`}
              onPress={() => move(item)}
            />
          )}
          {bill && (
            <Button title="Remove" kind="danger" loading={busy === `remove:${bill.id}`} onPress={() => remove(item)} />
          )}
        </Row>
      </View>
    );
  };

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: copy.title }} />
      <Card style={{ borderColor: copy.accent }}>
        <T variant="small">
          {copy.icon} {copy.title.toUpperCase()} · PER MONTH
        </T>
        <T variant="money" style={{ fontSize: 32, fontWeight: '800' }}>
          {moneyWhole(list.total)}
        </T>
        <T variant="muted">{copy.about}</T>
      </Card>
      <ErrorText message={error ?? err} />

      <Button
        title={`＋ Add a ${side} expense`}
        onPress={() => router.push({ pathname: '/expenses/pick', params: { type: side } })}
      />

      <Card>
        <T variant="heading">{side === 'fixed' ? 'Your fixed expenses' : 'Your variable expenses'}</T>
        {list.items.length === 0 && (
          <T variant="muted">
            Nothing here yet. Add one from your bank activity above, or move one here from {other} expenses.
          </T>
        )}
        {[...bills, ...spending].map((item, i) => (
          <View key={`${item.kind}${item.id ?? 'none'}`} style={{ gap: Spacing.md }}>
            {i > 0 && <Divider />}
            <ItemRow item={item} />
          </View>
        ))}
      </Card>

      <T variant="small" style={{ color: c.textMuted }}>
        Credit card payments aren&apos;t listed: the purchases on the card are already counted.
      </T>
    </Screen>
  );
}
