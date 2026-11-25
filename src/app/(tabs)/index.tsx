import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorText,
  GradientCard,
  MeterRow,
  Row,
  Screen,
  SectionHeader,
  Segmented,
  Stat,
  T,
} from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { money, moneyWhole, shortDate } from '@/lib/format';
import {
  balances,
  expenseBills,
  incomingChecks,
  toBillSchedule,
  useHouseholdData,
} from '@/lib/household-data';
import { categoryEmoji } from '@/lib/visuals';
import {
  budgetHelpDue,
  cutSuggestions,
  expenseBreakdown,
  periodMonths,
  spendingByCategory,
  totalsFor,
  trailingAverages,
  trailingMonths,
} from '@/lib/insights';
import { dueDates, endOfMonth, monthlyAmount, today } from '@/lib/schedule';
import { budgetCommission } from '@/lib/taxes';

type Period = '1' | '3' | '6' | '12';
const PERIODS: { value: Period; label: string }[] = [
  { value: '1', label: 'This month' },
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Overview() {
  const c = useTheme();
  const { household } = useAuth();
  const { data, loading, error, reload } = useHouseholdData();
  const [period, setPeriod] = useState<Period>('1');

  const now = useMemo(() => new Date(), []);
  const { cash, cards, cardAccounts } = balances(data.accounts);
  const avg = trailingAverages(data.flows, now, data.firstDate);
  // Income you can count on: your paychecks (Plan > Income) plus commission
  // at its slow-month estimate, after taxes.
  const commission = budgetCommission({
    low: household?.commission_low ?? null,
    high: household?.commission_high ?? null,
    state: household?.tax_state ?? null,
    retirementPct: household?.retirement_pct ?? 0,
  });
  const expectedIncome =
    data.incomes.reduce((s, x) => s + monthlyAmount(x.frequency, x.amount), 0) + commission.net;
  const split = expenseBreakdown(
    data.flows,
    data.categories,
    trailingMonths(now, data.firstDate),
    expenseBills(data.bills, data.accounts, data.liabilities),
  );

  // Rest of this month: paychecks still coming, bills still due.
  const rest = useMemo(() => {
    const from = today();
    const to = endOfMonth(from);
    const checks = incomingChecks(data.incomes, data.expected, from, to);
    const bills = data.bills
      .map((b) => toBillSchedule(b, data.liabilities))
      .flatMap((b) => dueDates(b, from, to))
      .filter((b) => b.amount > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const incoming = checks.reduce((s, x) => s + x.amount, 0);
    const outgoing = bills.reduce((s, x) => s + x.amount, 0);
    return { checks, bills, incoming, outgoing };
  }, [data.incomes, data.expected, data.bills, data.liabilities]);

  // Monthly budget check-in: the first week of each month, until you act.
  const cuts = cutSuggestions(data.flows, data.categories, now, data.firstDate);
  const showCheckIn =
    now.getDate() <= 7 &&
    budgetHelpDue(
      cuts,
      new Map(data.categories.map((k) => [k.id, k.monthly_budget])),
      household?.budget_help_month ?? null,
      now,
    );
  const cutSavings = cuts.reduce((s, x) => s + x.savings, 0);

  const months = periodMonths(now, Number(period));
  const totals = totalsFor(data.flows, months);
  const catById = new Map(data.categories.map((x) => [x.id, x]));
  const byCategory = spendingByCategory(data.flows, months);
  const maxCat = byCategory[0]?.amount ?? 0;
  const perMonth = Number(period) > 1;

  const monthName = now.toLocaleDateString('en-US', { month: 'long' });
  const noAccounts = !loading && data.accounts.length === 0;
  const noPlan = data.incomes.length === 0 && data.bills.length === 0;

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <View style={{ gap: 2, marginTop: Spacing.sm }}>
        <T variant="muted">{greeting()}</T>
        <T variant="title">{household?.name ?? 'Overview'}</T>
      </View>
      <ErrorText message={error} />

      {noAccounts ? (
        <Card>
          <T variant="heading">Connect your first bank</T>
          <T variant="muted">Link checking, savings and credit cards to start tracking.</T>
          <Button title="Connect a bank" onPress={() => router.push('/accounts')} />
        </Card>
      ) : (
        <GradientCard colors={c.gradMoney}>
          <T color={c.heroMuted} style={styles.heroLabel}>
            CASH IN CHECKING & SAVINGS
          </T>
          <T color={c.heroText} style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
            {moneyWhole(cash)}
          </T>
          <View style={[styles.heroDivider, { backgroundColor: c.heroMuted }]} />
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <T color={c.heroMuted} style={styles.heroSmall}>
                Card balances
              </T>
              <T color={c.heroText} style={styles.heroSub}>
                {moneyWhole(cards)}
              </T>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <T color={c.heroMuted} style={styles.heroSmall}>
                After paying cards
              </T>
              <T color={c.heroText} style={styles.heroSub}>
                {moneyWhole(cash - cards)}
              </T>
            </View>
          </Row>
          {cardAccounts.length > 0 && (
            <View style={[styles.cardList, { borderColor: c.heroMuted }]}>
              {cardAccounts.map((a) => (
                <Row key={a.id} style={{ justifyContent: 'space-between' }}>
                  <T color={c.heroMuted} style={styles.heroSmall} numberOfLines={1}>
                    💳 {a.name}
                    {a.last_four ? ` ••${a.last_four}` : ''}
                  </T>
                  <T color={c.heroText} style={[styles.heroSmall, { fontWeight: '700', fontVariant: ['tabular-nums'] }]}>
                    {money(a.balance_ledger ?? 0)}
                  </T>
                </Row>
              ))}
            </View>
          )}
        </GradientCard>
      )}

      {showCheckIn && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Monthly budget check-in: save about ${moneyWhole(cutSavings)} a month. Open`}
          onPress={() => router.push({ pathname: '/plan', params: { section: 'budget' } })}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Card style={{ backgroundColor: c.primarySoft, borderColor: c.primary }}>
            <T style={{ fontWeight: '700' }} color={c.primary}>
              🗓️ Your {monthName} budget check-in is ready
            </T>
            <T variant="small">
              {cuts.length} place{cuts.length === 1 ? '' : 's'} to cut could save about {moneyWhole(cutSavings)} a
              month. Tap to review and set your budget ›
            </T>
          </Card>
        </Pressable>
      )}

      {/* Trailing 12-month averages */}
      <SectionHeader title="Each month" />
      <Row style={{ gap: Spacing.md, alignItems: 'stretch' }}>
        <Stat
          label="Expected income"
          icon="💰"
          accent="#1BAF7A"
          value={moneyWhole(expectedIncome)}
          color={c.positive}
          sub={commission.net ? `incl. ${moneyWhole(commission.net)} commission (slow month)` : 'from your paychecks'}
          onPress={() => router.push({ pathname: '/plan', params: { section: 'income' } })}
        />
        <Stat label="Expenses" icon="🧾" accent="#EB6834" value={moneyWhole(avg.spent)} sub="monthly average" />
      </Row>
      {avg.months > 0 && (
        <Row style={{ gap: Spacing.md, alignItems: 'stretch' }}>
          <Stat
            label="Fixed"
            icon="📌"
            accent="#6250D6"
            value={moneyWhole(split.fixed.total)}
            sub={`${split.fixed.items.length} expense${split.fixed.items.length === 1 ? '' : 's'} · tap to edit`}
            onPress={() => router.push('/expenses/fixed')}
          />
          <Stat
            label="Variable"
            icon="🛒"
            accent="#EDA100"
            value={moneyWhole(split.variable.total)}
            sub={`${split.variable.items.length} expense${split.variable.items.length === 1 ? '' : 's'} · tap to edit`}
            onPress={() => router.push('/expenses/variable')}
          />
        </Row>
      )}
      <T variant="small" style={{ marginTop: -Spacing.sm }}>
        {avg.months
          ? avg.months >= 12
            ? 'Income: what your paychecks and commission estimate bring in. Expenses: the last 12 complete months.'
            : `Income: what your paychecks and commission estimate bring in. Expenses: ${avg.months} complete month${avg.months === 1 ? '' : 's'} of bank history so far.`
          : 'Averages appear after your first complete month of history.'}
      </T>

      {/* Rest of this month */}
      <SectionHeader title={`Rest of ${monthName}`} action={noPlan ? undefined : 'Plan'} onAction={() => router.push('/plan')} />
      <Card>
        {noPlan ? (
          <>
            <T variant="heading">See what&apos;s still coming</T>
            <T variant="muted">
              Add your paychecks and bills in Plan to see what&apos;s incoming and what&apos;s still due
              this month.
            </T>
            <Button title="Set up paychecks & bills" kind="secondary" onPress={() => router.push('/plan')} />
          </>
        ) : (
          <>
            <Row style={{ gap: Spacing.md }}>
              <View style={{ flex: 1 }}>
                <T variant="small">Incoming</T>
                <T variant="money" color={c.positive} style={{ fontSize: 20 }}>
                  {moneyWhole(rest.incoming)}
                </T>
              </View>
              <View style={{ flex: 1 }}>
                <T variant="small">Bills left</T>
                <T variant="money" style={{ fontSize: 20 }}>
                  {moneyWhole(rest.outgoing)}
                </T>
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <T variant="small">Difference</T>
                <T
                  variant="money"
                  color={rest.incoming - rest.outgoing >= 0 ? c.positive : c.negative}
                  style={{ fontSize: 20 }}>
                  {moneyWhole(rest.incoming - rest.outgoing)}
                </T>
              </View>
            </Row>
            <Divider />
            {rest.checks.length === 0 && <T variant="muted">No more paychecks this month.</T>}
            {rest.checks.map((x) => (
              <Pressable
                key={x.key}
                accessibilityRole="button"
                accessibilityLabel={`${x.name}, ${shortDate(x.date)}, ${money(x.amount)}. Edit amount`}
                onPress={() =>
                  router.push(
                    x.expected
                      ? { pathname: '/payday', params: { id: x.expected.id } }
                      : {
                          pathname: '/payday',
                          params: { source: x.sourceId ?? '', date: x.date, name: x.name, scheduled: String(x.scheduled ?? '') },
                        },
                  )
                }
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row style={{ gap: Spacing.xs, flexShrink: 1 }}>
                    <T numberOfLines={1} style={{ flexShrink: 1 }}>
                      {x.name} <T variant="small">· {shortDate(x.date)}</T>
                    </T>
                    {x.expected?.gross != null && <Badge text="commission" tone="primary" />}
                    {x.expected && x.expected.gross == null && x.sourceId && <Badge text="edited" />}
                  </Row>
                  <T variant="money" color={c.positive}>
                    +{money(x.amount)} <T variant="small">✎</T>
                  </T>
                </Row>
              </Pressable>
            ))}
            <Button
              title="＋ Add commission or other income"
              kind="secondary"
              onPress={() => router.push({ pathname: '/payday', params: { date: today() } })}
            />
            {rest.bills.length === 0 && <T variant="muted">No more bills due this month.</T>}
            {rest.bills.map((x) => (
              <Row key={x.id} style={{ justifyContent: 'space-between' }}>
                <T>
                  {x.name} <T variant="small">· due {shortDate(x.date)}</T>
                </T>
                <T variant="money">−{money(x.amount)}</T>
              </Row>
            ))}
          </>
        )}
      </Card>

      {/* Period totals and spending */}
      <SectionHeader title="Income & spending" />
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      <Row style={{ gap: Spacing.md, alignItems: 'stretch' }}>
        <Stat label="Income" icon="💰" accent="#1BAF7A" value={moneyWhole(totals.income)} color={c.positive} />
        <Stat label="Spent" icon="💸" accent="#EB6834" value={moneyWhole(totals.spent)} />
        <Stat
          label="Net"
          icon={totals.net >= 0 ? '📈' : '📉'}
          accent={totals.net >= 0 ? '#2A78D6' : '#E34948'}
          value={moneyWhole(totals.net)}
          color={totals.net >= 0 ? c.positive : c.negative}
        />
      </Row>
      {totals.saved > 0 && (
        <Card style={{ padding: Spacing.md, backgroundColor: c.primarySoft, borderColor: c.primarySoft }}>
          <T>
            <T style={{ fontWeight: '700' }} color={c.primary}>
              {moneyWhole(totals.saved)}
            </T>{' '}
            moved to savings & investments 🐷. That&apos;s not counted as spending.
          </T>
        </Card>
      )}

      <Card>
        <T variant="heading">Spending by category</T>
        {byCategory.length === 0 && <T variant="muted">No spending in this period.</T>}
        {byCategory.length > 0 && (
          // Where the money went, at a glance: one block per category.
          <View style={styles.mix} accessibilityLabel="Share of spending by category">
            {byCategory.map(({ categoryId, amount }) => (
              <View
                key={categoryId ?? 'none'}
                style={{ flex: amount, backgroundColor: (categoryId && catById.get(categoryId)?.color) || c.textMuted }}
              />
            ))}
          </View>
        )}
        {byCategory.map(({ categoryId, amount }) => {
          const cat = categoryId ? catById.get(categoryId) : undefined;
          const months = Number(period);
          const share = totals.spent > 0 ? Math.round((amount / totals.spent) * 100) : 0;
          return (
            <MeterRow
              key={categoryId ?? 'none'}
              onPress={() =>
                router.push({ pathname: '/category/[id]', params: { id: categoryId ?? 'none', months: period } })
              }
              icon={categoryEmoji(cat)}
              color={cat?.color ?? c.textMuted}
              label={cat?.name ?? 'Uncategorized'}
              value={amount}
              max={maxCat}
              figure={money(amount)}
              limit={!perMonth ? cat?.monthly_budget : null}
              detail={
                perMonth
                  ? `${money(amount / months)} / month · ${share}% of spending`
                  : cat?.monthly_budget
                    ? `${share}% of spending · budget ${moneyWhole(cat.monthly_budget)}`
                    : `${share}% of spending`
              }
            />
          );
        })}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  mix: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 },
  heroLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  heroValue: { fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroDivider: { height: StyleSheet.hairlineWidth, opacity: 0.4, marginVertical: Spacing.md },
  heroSmall: { fontSize: 13 },
  heroSub: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardList: { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
});
