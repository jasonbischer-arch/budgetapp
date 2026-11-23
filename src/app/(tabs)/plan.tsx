import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import PlaidLink from '@/components/plaid-link';
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorText,
  Input,
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
import {
  Category,
  fetchIncomeTransactions,
  saveIncomeSource,
  setCategoryBudgets,
  updateCategoryBudget,
} from '@/lib/data';
import { money, moneyWhole, monthShort, ordinal, shortDate, weekday } from '@/lib/format';
import {
  debtDetails,
  HouseholdData,
  toBillSchedule,
  useHouseholdData,
} from '@/lib/household-data';
import { cutSuggestions, periodMonths, spendingByCategory } from '@/lib/insights';
import {
  addDays,
  buildPaycheckPlan,
  detectIncome,
  endOfMonth,
  IncomeSuggestion,
  monthlyAmount,
  paydays,
  PlannedCheck,
  startOfMonth,
  today,
} from '@/lib/schedule';
import { callFunction } from '@/lib/supabase';

type Section = 'plan' | 'bills' | 'income' | 'budget';
const SECTIONS: { value: Section; label: string }[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'bills', label: 'Bills' },
  { value: 'income', label: 'Income' },
  { value: 'budget', label: 'Budget' },
];

export default function PlanScreen() {
  const [section, setSection] = useState<Section>('plan');
  const { data, loading, error, reload } = useHouseholdData();

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <T variant="title" style={{ marginTop: Spacing.sm }}>
        Plan
      </T>
      <Segmented options={SECTIONS} value={section} onChange={setSection} />
      <ErrorText message={error} />
      {section === 'plan' && <PaycheckPlanView data={data} goTo={setSection} />}
      {section === 'bills' && <BillsView data={data} reload={reload} />}
      {section === 'income' && <IncomeView data={data} reload={reload} />}
      {section === 'budget' && <BudgetView data={data} reload={reload} />}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Paycheck plan
// ---------------------------------------------------------------------------

function PaycheckPlanView({ data, goTo }: { data: HouseholdData; goTo: (s: Section) => void }) {
  const c = useTheme();
  const plan = useMemo(() => {
    const from = today();
    const to = endOfMonth(addDays(endOfMonth(from), 1)); // through end of next month
    return buildPaycheckPlan(
      data.incomes,
      data.bills.map((b) => toBillSchedule(b, data.liabilities)),
      from,
      to,
    );
  }, [data.incomes, data.bills, data.liabilities]);

  if (!data.incomes.length || !data.bills.length) {
    return (
      <Card>
        <T variant="heading">Build your paycheck plan</T>
        <T variant="muted">
          Add your paychecks and bills, and the plan assigns each bill to a paycheck so every
          check keeps about the same amount.
        </T>
        {!data.incomes.length && (
          <Button title="Add paychecks" onPress={() => goTo('income')} />
        )}
        {!data.bills.length && (
          <Button title="Add bills" kind="secondary" onPress={() => goTo('bills')} />
        )}
      </Card>
    );
  }

  // Typical leftover, ignoring checks forced low by a bill due right after.
  const lefts = plan.checks.map((x) => x.leftover).sort((a, b) => a - b);
  const typical = lefts.length ? lefts[Math.floor(lefts.length / 2)] : 0;
  const maxAmount = Math.max(...plan.checks.map((x) => x.amount), 1);

  const byMonth = new Map<string, PlannedCheck[]>();
  for (const check of plan.checks) {
    const key = startOfMonth(check.date);
    byMonth.set(key, [...(byMonth.get(key) ?? []), check]);
  }

  return (
    <>
      <View style={[styles.summary, { backgroundColor: c.hero }]}>
        <T color={c.heroMuted} style={styles.summaryLabel}>
          LEFT PER PAYCHECK
        </T>
        <T color={c.heroText} style={styles.summaryValue}>
          about {moneyWhole(typical)}
        </T>
        <T color={c.heroMuted}>
          Each bill is paid from a check that arrives before it&apos;s due. Big bills may be split,
          with part set aside from an earlier check.
        </T>
      </View>

      {plan.fromCash.length > 0 && (
        <Card style={{ backgroundColor: c.warningSoft, borderColor: c.warningSoft }}>
          <T variant="heading">Pay from cash on hand</T>
          <T variant="muted">Due before your next paycheck arrives:</T>
          {plan.fromCash.map((b) => (
            <Row key={b.id} style={{ justifyContent: 'space-between' }}>
              <T>
                {b.name} <T variant="small">· due {shortDate(b.date)}</T>
              </T>
              <T variant="money">{money(b.amount)}</T>
            </Row>
          ))}
        </Card>
      )}

      {[...byMonth.entries()].map(([month, checks]) => (
        <View key={month} style={{ gap: Spacing.md }}>
          <SectionHeader
            title={new Date(month + 'T12:00:00').toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })}
          />
          {checks.map((check) => (
            <CheckCard key={check.id} check={check} typical={typical} maxAmount={maxAmount} />
          ))}
        </View>
      ))}
    </>
  );
}

function CheckCard({ check, typical, maxAmount }: { check: PlannedCheck; typical: number; maxAmount: number }) {
  const c = useTheme();
  const low = check.leftover < typical - 100;
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <View>
          <T variant="heading">{check.name}</T>
          <T variant="small">
            {weekday(check.date)}, {shortDate(check.date)}
          </T>
        </View>
        <T variant="money" color={c.positive} style={{ fontSize: 17 }}>
          +{money(check.amount)}
        </T>
      </Row>
      {check.bills.length > 0 && <Divider />}
      {check.bills.map((b) => (
        <Row key={b.id} style={{ justifyContent: 'space-between' }}>
          <View style={{ flexShrink: 1 }}>
            <T numberOfLines={1}>{b.name}</T>
            <T variant="small">
              {b.split
                ? `Set aside ${money(b.amount)} of ${money(b.fullAmount)} · due ${shortDate(b.date)}`
                : `Due ${shortDate(b.date)}`}
            </T>
          </View>
          <T variant="money">−{money(b.amount)}</T>
        </Row>
      ))}
      <View style={[styles.leftBox, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="small">Left after bills</T>
          <T variant="money" style={{ fontSize: 18 }} color={check.leftover < 0 ? c.negative : undefined}>
            {money(check.leftover)}
          </T>
        </Row>
        <View style={[styles.track, { backgroundColor: c.track }]}>
          <View
            style={{
              width: `${Math.max(0, Math.min(1, check.leftover / maxAmount)) * 100}%`,
              height: '100%',
              borderRadius: 4,
              backgroundColor: check.leftover < 0 ? c.negative : c.bar,
            }}
          />
        </View>
        {low && (
          <T variant="small">Less than usual: a bill is due before the next paycheck arrives.</T>
        )}
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bills & debts
// ---------------------------------------------------------------------------

function frequencyLabel(f: string, dueDay: number, dueMonth: number | null) {
  if (f === 'monthly') return `Due the ${ordinal(dueDay)} monthly`;
  if (f === 'quarterly') return `Due the ${ordinal(dueDay)} every 3 months (from ${monthShort(dueMonth ?? 1)})`;
  return `Due ${monthShort(dueMonth ?? 1)} ${dueDay} yearly`;
}

function BillsView({ data, reload }: { data: HouseholdData; reload: () => void }) {
  const c = useTheme();
  const [link, setLink] = useState<{ token: string; itemId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = data.bills.map((bill) => ({
    bill,
    schedule: toBillSchedule(bill, data.liabilities),
    debt: debtDetails(bill, data.accounts, data.liabilities),
  }));
  const monthlyBills = rows.reduce(
    (s, r) => s + monthlyAmount(r.bill.frequency, r.schedule.amount),
    0,
  );
  const debts = rows.filter((r) => r.bill.is_debt);
  const totalDebt = debts.reduce((s, r) => s + (r.debt.balance ?? 0), 0);
  const interest = debts.reduce((s, r) => s + (r.debt.monthlyInterest ?? 0), 0);
  const highestApr = [...debts]
    .filter((r) => r.debt.apr != null && (r.debt.balance ?? 0) > 0)
    .sort((a, b) => (b.debt.apr ?? 0) - (a.debt.apr ?? 0))[0];

  // Connected cards and loans that aren't tracked as a bill yet.
  const tracked = new Set(data.bills.map((b) => b.account_id).filter(Boolean));
  const debtAccounts = data.accounts.filter((a) => (a.type === 'credit' || a.type === 'loan') && !a.hidden);
  const untracked = debtAccounts.filter((a) => !tracked.has(a.id));
  const withDetails = new Set(data.liabilities.map((l) => l.account_id));
  const missingDetailsItem = debtAccounts.find((a) => !withDetails.has(a.id))?.item_id;

  async function allowDebtDetails(itemId: string) {
    setBusy(true);
    setErr(null);
    try {
      const { linkToken } = await callFunction<{ linkToken: string }>('plaid-link-token', {
        itemId,
        addDebtDetails: true,
      });
      setLink({ token: linkToken, itemId });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Row style={{ gap: Spacing.md, alignItems: 'stretch' }}>
        <Stat label="Bills / month" value={moneyWhole(monthlyBills)} />
        <Stat label="Total debt" value={moneyWhole(totalDebt)} />
        <Stat label="Interest / mo" value={moneyWhole(interest)} color={interest > 0 ? c.negative : undefined} />
      </Row>

      {highestApr && (
        <Card style={{ backgroundColor: c.primarySoft, borderColor: c.primarySoft, padding: Spacing.md }}>
          <T>
            Extra money goes furthest on{' '}
            <T style={{ fontWeight: '700' }}>{highestApr.bill.name}</T>: it has your highest rate (
            {highestApr.debt.apr}% APR), costing about {money(highestApr.debt.monthlyInterest ?? 0)} a
            month in interest.
          </T>
        </Card>
      )}

      <SectionHeader title="Bills & debts" action="+ Add bill" onAction={() => router.push('/bill/new')} />
      <Card>
        {rows.length === 0 && (
          <T variant="muted">
            Add rent, utilities, insurance, subscriptions and loan payments. They feed your
            paycheck plan.
          </T>
        )}
        {rows.map(({ bill, schedule, debt }, i) => (
          <View key={bill.id} style={{ gap: Spacing.sm }}>
            {i > 0 && <Divider />}
            <Pressable
              onPress={() => router.push({ pathname: '/bill/[id]', params: { id: bill.id } })}
              style={({ pressed }) => [{ gap: 4 }, pressed && { opacity: 0.6 }]}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row style={{ gap: 6, flexShrink: 1 }}>
                  <T numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }}>
                    {bill.name}
                  </T>
                  {bill.is_debt && <Badge text="DEBT" tone="warning" />}
                  {debt.linked && <Badge text="SYNCED" tone="primary" />}
                </Row>
                <T variant="money">{money(schedule.amount)}</T>
              </Row>
              <T variant="small">
                {frequencyLabel(bill.frequency, bill.due_day, bill.due_month)}
                {bill.amount == null && debt.linked ? ' · minimum payment' : ''}
              </T>
              {bill.is_debt && (
                <T variant="small">
                  Balance {debt.balance != null ? money(debt.balance) : '—'}
                  {debt.apr != null ? ` · ${debt.apr}% APR` : ''}
                  {debt.monthlyInterest != null ? ` · ~${money(debt.monthlyInterest)} interest/mo` : ''}
                </T>
              )}
            </Pressable>
          </View>
        ))}
      </Card>

      {untracked.length > 0 && (
        <>
          <SectionHeader title="Connected cards & loans" />
          <Card>
            <T variant="muted">Track these as bills. Balances update with every bank sync.</T>
            {untracked.map((a) => {
              const l = data.liabilities.find((x) => x.account_id === a.id);
              return (
                <Row key={a.id} style={{ justifyContent: 'space-between' }}>
                  <View style={{ flexShrink: 1 }}>
                    <T numberOfLines={1}>
                      {a.name}
                      {a.last_four ? ` ••${a.last_four}` : ''}
                    </T>
                    <T variant="small">
                      Owed {money(Math.abs(a.balance_ledger ?? 0))}
                      {l?.apr != null ? ` · ${l.apr}% APR` : ''}
                      {l?.minimum_payment != null ? ` · min ${money(l.minimum_payment)}` : ''}
                    </T>
                  </View>
                  <Button
                    title="Track"
                    kind="secondary"
                    onPress={() => router.push({ pathname: '/bill/[id]', params: { id: 'new', accountId: a.id } })}
                  />
                </Row>
              );
            })}
          </Card>
        </>
      )}

      {missingDetailsItem && (
        <Card>
          <T variant="heading">Get rates & minimums automatically</T>
          <T variant="muted">
            Allow your bank to share interest rates, minimum payments and due dates for your cards
            and loans. Plaid asks you to confirm once.
          </T>
          <Button title="Allow debt details" kind="secondary" loading={busy} onPress={() => allowDebtDetails(missingDetailsItem)} />
        </Card>
      )}
      <ErrorText message={err} />

      {link && (
        <PlaidLink
          linkToken={link.token}
          onSuccess={async () => {
            const itemId = link.itemId;
            setLink(null);
            await callFunction('plaid-sync', { itemId }).catch(() => {});
            reload();
          }}
          onExit={(message) => {
            setLink(null);
            if (message) setErr(message);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

function scheduleLabel(s: { frequency: string; day1: number | null; day2: number | null }) {
  switch (s.frequency) {
    case 'weekly':
      return 'Every week';
    case 'biweekly':
      return 'Every 2 weeks';
    case 'semimonthly':
      return `The ${ordinal(s.day1 ?? 1)} and ${ordinal(s.day2 ?? 15)}`;
    default:
      return `The ${ordinal(s.day1 ?? 1)} of each month`;
  }
}

function IncomeView({ data, reload }: { data: HouseholdData; reload: () => void }) {
  const c = useTheme();
  const { household } = useAuth();
  const [suggestions, setSuggestions] = useState<IncomeSuggestion[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchIncomeTransactions(addDays(today(), -120))
      .then((txns) => setSuggestions(detectIncome(txns)))
      .catch(() => setSuggestions([]));
  }, []);

  const existing = data.incomes.map((s) => s.name.toLowerCase());
  const fresh = suggestions.filter(
    (s) => !existing.some((n) => n.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(n)),
  );
  const monthly = data.incomes.reduce((s, x) => s + monthlyAmount(x.frequency, x.amount), 0);

  async function addSuggestion(s: IncomeSuggestion) {
    if (!household) return;
    try {
      await saveIncomeSource(household.id, {
        name: s.name,
        amount: s.amount,
        frequency: s.frequency,
        anchor_date: s.anchor_date,
        day1: s.day1,
        day2: s.day2,
      });
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Row style={{ gap: Spacing.md, alignItems: 'stretch' }}>
        <Stat label="Expected / month" value={moneyWhole(monthly)} color={c.positive} />
        <Stat label="Paychecks" value={String(data.incomes.length)} />
      </Row>

      <SectionHeader title="Paychecks" action="+ Add" onAction={() => router.push('/income/new')} />
      <Card>
        {data.incomes.length === 0 && (
          <T variant="muted">Add each paycheck with its schedule, e.g. every other Friday, or the 7th and 22nd.</T>
        )}
        {data.incomes.map((src, i) => {
          const next = paydays(src, today(), addDays(today(), 62))[0];
          return (
            <View key={src.id} style={{ gap: Spacing.sm }}>
              {i > 0 && <Divider />}
              <Pressable
                onPress={() => router.push({ pathname: '/income/[id]', params: { id: src.id } })}
                style={({ pressed }) => [{ gap: 4 }, pressed && { opacity: 0.6 }]}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T style={{ fontWeight: '600' }}>{src.name}</T>
                  <T variant="money" color={c.positive}>
                    {money(src.amount)}
                  </T>
                </Row>
                <T variant="small">
                  {scheduleLabel(src)}
                  {next ? ` · next ${weekday(next.date)}, ${shortDate(next.date)}` : ''}
                </T>
              </Pressable>
            </View>
          );
        })}
      </Card>

      {fresh.length > 0 && (
        <>
          <SectionHeader title="Found in your deposits" />
          <Card>
            {fresh.map((s, i) => (
              <View key={s.name} style={{ gap: Spacing.sm }}>
                {i > 0 && <Divider />}
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flexShrink: 1 }}>
                    <T style={{ fontWeight: '600' }} numberOfLines={1}>
                      {s.name}
                    </T>
                    <T variant="small">
                      {money(s.amount)} · {scheduleLabel(s)} · seen {s.occurrences}×
                    </T>
                  </View>
                  <Button title="Add" kind="secondary" onPress={() => addSuggestion(s)} />
                </Row>
              </View>
            ))}
          </Card>
        </>
      )}
      <ErrorText message={err} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Budget: where to cut + category limits
// ---------------------------------------------------------------------------

function BudgetView({ data, reload }: { data: HouseholdData; reload: () => void }) {
  const c = useTheme();
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const now = useMemo(() => new Date(), []);

  const cuts = cutSuggestions(data.flows, data.categories, now);
  const monthlySavings = cuts.reduce((s, x) => s + x.savings, 0);
  const thisMonth = new Map(
    spendingByCategory(data.flows, periodMonths(now, 1)).map((x) => [x.categoryId, x.amount]),
  );
  const expenseCats = data.categories.filter((x) => x.kind === 'expense');
  const budgeted = expenseCats.filter((x) => x.monthly_budget);
  const totalBudget = budgeted.reduce((s, x) => s + (x.monthly_budget ?? 0), 0);
  const totalSpent = budgeted.reduce((s, x) => s + (thisMonth.get(x.id) ?? 0), 0);
  const applied = cuts.length > 0 && cuts.every((x) => data.categories.find((k) => k.id === x.categoryId)?.monthly_budget === x.target);

  async function applyCuts() {
    setApplying(true);
    setErr(null);
    try {
      await setCategoryBudgets(cuts.map((x) => ({ id: x.categoryId, monthly_budget: x.target })));
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  async function saveBudget(cat: Category, value: number | null) {
    try {
      await updateCategoryBudget(cat.id, value);
      setErr(null);
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <SectionHeader title="Where you can cut" />
      <Card>
        {cuts.length === 0 ? (
          <T variant="muted">
            No easy cuts found yet. Suggestions appear once there are a few months of spending in
            flexible categories like dining, shopping and entertainment.
          </T>
        ) : (
          <>
            <View style={[styles.savingsBox, { backgroundColor: c.primarySoft }]}>
              <T variant="small">You could save about</T>
              <T variant="money" color={c.primary} style={{ fontSize: 28, fontWeight: '800' }}>
                {moneyWhole(monthlySavings)}/month
              </T>
              <T variant="small">{moneyWhole(monthlySavings * 12)} a year</T>
            </View>
            {cuts.map((x) => (
              <View key={x.categoryId} style={{ gap: 2 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T style={{ fontWeight: '600' }}>{x.name}</T>
                  <T variant="money" color={c.positive}>
                    save {moneyWhole(x.savings)}
                  </T>
                </Row>
                <T variant="small">
                  Avg {moneyWhole(x.average)} → budget {moneyWhole(x.target)} · {x.reason}
                </T>
              </View>
            ))}
            <Button
              title={applied ? 'Applied as budgets ✓' : 'Use these as my budgets'}
              onPress={applyCuts}
              loading={applying}
              disabled={applied}
            />
          </>
        )}
      </Card>

      <SectionHeader title="Monthly budgets" />
      {totalBudget > 0 && (
        <Card>
          <MeterRow
            label="This month"
            value={totalSpent}
            max={totalBudget}
            limit={totalBudget}
            figure={`${moneyWhole(totalSpent)} of ${moneyWhole(totalBudget)}`}
            detail="Spending in categories with a budget"
          />
        </Card>
      )}
      <Card>
        <T variant="muted">Leave blank for no budget.</T>
        {expenseCats.map((cat, i) => {
          const spent = thisMonth.get(cat.id) ?? 0;
          return (
            <View key={cat.id} style={{ gap: Spacing.sm }}>
              {i > 0 && <Divider />}
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T>{cat.name}</T>
                  <T variant="small">{money(spent)} spent this month</T>
                </View>
                <BudgetInput cat={cat} onSave={saveBudget} />
              </Row>
              {!!cat.monthly_budget && (
                <View style={[styles.track, { backgroundColor: c.track }]}>
                  <View
                    style={{
                      width: `${Math.min(1, spent / cat.monthly_budget) * 100}%`,
                      height: '100%',
                      borderRadius: 4,
                      backgroundColor: spent > cat.monthly_budget ? c.negative : c.bar,
                    }}
                  />
                </View>
              )}
            </View>
          );
        })}
      </Card>
      <ErrorText message={err} />
    </>
  );
}

function BudgetInput({ cat, onSave }: { cat: Category; onSave: (cat: Category, value: number | null) => void }) {
  const initial = cat.monthly_budget != null ? String(cat.monthly_budget) : '';
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  const commit = () => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    const value = cleaned === '' ? null : Number(cleaned);
    if (value != null && Number.isNaN(value)) return setText(initial);
    if (value !== cat.monthly_budget) onSave(cat, value);
  };
  return (
    <Input
      value={text}
      onChangeText={setText}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder="$0"
      keyboardType="decimal-pad"
      returnKeyType="done"
      accessibilityLabel={`${cat.name} monthly budget`}
      style={{ width: 110, textAlign: 'right' }}
    />
  );
}

const styles = StyleSheet.create({
  summary: { borderRadius: Radius.lg + 4, padding: Spacing.xl, gap: Spacing.xs },
  summaryLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  summaryValue: { fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  leftBox: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.md, gap: Spacing.sm },
  track: { height: 8, borderRadius: 4 },
  savingsBox: { borderRadius: Radius.md, padding: Spacing.lg, gap: 2, alignItems: 'center' },
});
