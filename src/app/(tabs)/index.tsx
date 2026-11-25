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
import { money, moneyWhole, shareLabel, shortDate, weekday } from '@/lib/format';
import {
  balances,
  householdPlan,
  incomingChecks,
  monthlyCashFlow,
  toBillSchedule,
  useHouseholdData,
} from '@/lib/household-data';
import { categoryEmoji } from '@/lib/visuals';
import {
  budgetHelpDue,
  cutSuggestions,
  periodMonths,
  spendingByCategory,
  totalsFor,
  trailingAverages,
} from '@/lib/insights';
import { dueDates, endOfMonth, today } from '@/lib/schedule';

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
  // Income you can count on (paychecks + slow-month commission) vs your fixed
  // and variable expenses: what's left each month.
  const cf = monthlyCashFlow(data, household);
  const { commission, split } = cf;
  const expectedIncome = cf.income;

  // Rest of this month: paychecks still coming, and what your plan pays from
  // them (e.g. 1/4 of daycare from each check, even when it's due next month).
  const planMode = household?.plan_mode ?? 'even';
  const rest = useMemo(() => {
    const from = today();
    const to = endOfMonth(from);
    const checks = incomingChecks(data.incomes, data.expected, from, to);
    const { plan, fixed } = householdPlan(data, planMode);
    type Out = { id: string; name: string; date: string; due: string; amount: number; note: string };
    const out: Out[] = [];
    // Fixed bills: the pieces your plan takes from this month's checks.
    for (const check of plan.checks.filter((x) => x.date <= to)) {
      for (const b of check.bills) {
        const share = b.split ? shareLabel(b.amount / b.fullAmount) : null;
        out.push({
          id: `${check.id}:${b.id}`,
          name: share ? `${b.name} (${share})` : b.name,
          date: check.date,
          due: b.date,
          amount: b.amount,
          note: `from ${weekday(check.date).slice(0, 3)} ${shortDate(check.date)} check${b.date !== check.date ? ` · due ${shortDate(b.date)}` : ''}`,
        });
      }
    }
    // Due before any paycheck can cover them, or not on a check in your plan yet.
    for (const b of [...plan.fromCash, ...plan.unplanned].filter((x) => x.date <= to)) {
      out.push({ id: `x:${b.id}`, name: b.name, date: b.date, due: b.date, amount: b.amount, note: `due ${shortDate(b.date)} · not on a check` });
    }
    // Other bills (variable bills, card payments) still due this month.
    const fixedIds = new Set(fixed.map((b) => b.id));
    for (const b of data.bills
      .filter((x) => !fixedIds.has(x.id))
      .map((x) => toBillSchedule(x, data.liabilities))
      .flatMap((x) => dueDates(x, from, to))
      .filter((x) => x.amount > 0)) {
      out.push({ id: b.id, name: b.name, date: b.date, due: b.date, amount: b.amount, note: `due ${shortDate(b.date)}` });
    }
    const bills = out.sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
    const incoming = checks.reduce((s2, x) => s2 + x.amount, 0);
    const outgoing = bills.reduce((s2, x) => s2 + x.amount, 0);
    return { checks, bills, incoming, outgoing };
  }, [data, planMode]);

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
        <Stat label="Expenses" icon="🧾" accent="#EB6834" value={moneyWhole(cf.expenses)} sub="fixed + variable" />
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
      <Card style={{ borderColor: cf.net >= 0 ? c.positive : c.negative }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <T variant="small">💵 Cash flow (left each month)</T>
            <T variant="money" color={cf.net >= 0 ? c.positive : c.negative} style={{ fontSize: 26, fontWeight: '800' }}>
              {cf.net >= 0 ? '+' : '−'}
              {moneyWhole(Math.abs(cf.net))}
            </T>
          </View>
          <T variant="small" style={{ textAlign: 'right' }}>
            {moneyWhole(cf.net * 12)}
            {'\n'}a year
          </T>
        </Row>
        <T variant="small">
          Expected income − fixed and variable expenses (your budgets where set, averages elsewhere).
        </T>
        <Button title="💡 Find ways to cut" onPress={() => router.push('/savings')} />
      </Card>

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
              <Row key={x.id} style={{ justifyContent: 'space-between', gap: Spacing.sm }}>
                <View style={{ flexShrink: 1 }}>
                  <T numberOfLines={1}>{x.name}</T>
                  <T variant="small">{x.note}</T>
                </View>
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
