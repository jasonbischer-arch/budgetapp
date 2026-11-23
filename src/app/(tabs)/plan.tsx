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
  IncomeSource,
  resetCategoryBudget,
  saveSavingsPerCheck,
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
import {
  categoryAverages,
  cutSuggestions,
  expenseSplit,
  paycheckSplit,
  periodMonths,
  spendingByCategory,
  trailingMonths,
} from '@/lib/insights';
import {
  addDays,
  buildPaycheckPlan,
  endOfMonth,
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
// Paycheck plan: bills, then the same savings and spending money every check
// ---------------------------------------------------------------------------

function usePlan(data: HouseholdData, savingsOverride: number | null) {
  return useMemo(() => {
    const from = today();
    const to = endOfMonth(addDays(endOfMonth(from), 1)); // through end of next month
    const plan = buildPaycheckPlan(
      data.incomes,
      data.bills.map((b) => toBillSchedule(b, data.liabilities)),
      from,
      to,
    );
    // Typical leftover after bills: the median, so a check squeezed by a
    // bill due right after it doesn't drag the plan down.
    const lefts = plan.checks.map((x) => x.leftover).sort((a, b) => a - b);
    const typicalAfterBills = lefts.length ? lefts[Math.floor(lefts.length / 2)] : 0;

    // Variable spending per month: your budgets where set, else the average.
    const months = trailingMonths(new Date(), data.firstDate);
    const avg = categoryAverages(data.flows, months);
    const variablePerMonth = data.categories
      .filter((c) => c.kind === 'expense' && c.expense_type === 'variable')
      .reduce((s, c) => s + (c.monthly_budget ?? avg.get(c.id) ?? 0), 0);
    const checksPerMonth = data.incomes.reduce((s, x) => s + monthlyAmount(x.frequency, 1), 0);

    const split = paycheckSplit({ typicalAfterBills, variablePerMonth, checksPerMonth, savingsOverride });
    return { plan, typicalAfterBills, variablePerMonth, checksPerMonth, ...split };
  }, [data, savingsOverride]);
}

function PaycheckPlanView({ data, goTo }: { data: HouseholdData; goTo: (s: Section) => void }) {
  const c = useTheme();
  const { household, refreshHousehold } = useAuth();
  const savingsOverride = household?.savings_per_check ?? null;
  const p = usePlan(data, savingsOverride);
  const [editing, setEditing] = useState(false);
  const [savingsText, setSavingsText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  if (!data.incomes.length || !data.bills.length) {
    return (
      <Card>
        <T variant="heading">Build your paycheck plan</T>
        <T variant="muted">
          Once your paychecks and bills are in, the plan assigns each bill to a paycheck and
          gives every check the same savings and the same spending money. Paychecks are found
          automatically from your bank deposits.
        </T>
        {!data.incomes.length && <Button title="Add paychecks" onPress={() => goTo('income')} />}
        {!data.bills.length && <Button title="Add bills" kind="secondary" onPress={() => goTo('bills')} />}
      </Card>
    );
  }

  async function saveSavings(value: number | null) {
    if (!household) return;
    try {
      await saveSavingsPerCheck(household.id, value);
      await refreshHousehold();
      setEditing(false);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const byMonth = new Map<string, PlannedCheck[]>();
  for (const check of p.plan.checks) {
    const key = startOfMonth(check.date);
    byMonth.set(key, [...(byMonth.get(key) ?? []), check]);
  }
  const short = p.leftToSpend < p.spendPerCheck - 10;

  return (
    <>
      <View style={[styles.summary, { backgroundColor: c.hero }]}>
        <T color={c.heroMuted} style={styles.summaryLabel}>
          EVERY PAYCHECK
        </T>
        <Row style={{ gap: Spacing.xl, alignItems: 'flex-end' }}>
          <View>
            <T color={c.heroMuted}>Save</T>
            <T color={c.heroText} style={styles.summaryValue}>
              {moneyWhole(p.savings)}
            </T>
          </View>
          <View>
            <T color={c.heroMuted}>Left to spend</T>
            <T color={c.heroText} style={styles.summaryValue}>
              {moneyWhole(p.leftToSpend)}
            </T>
          </View>
        </Row>
        <T color={c.heroMuted}>
          Bills come out first, from a check that arrives before each is due. Then every check
          saves the same amount and leaves the same amount to spend.
        </T>
      </View>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '600' }}>Savings per paycheck</T>
            <T variant="small">
              {p.auto
                ? `Automatic: what's left after bills and your usual spending (${moneyWhole(p.spendPerCheck)} per check).`
                : 'Set by you.'}
            </T>
          </View>
          {!editing && (
            <Button
              title="Change"
              kind="secondary"
              onPress={() => {
                setSavingsText(String(p.savings));
                setEditing(true);
              }}
            />
          )}
        </Row>
        {editing && (
          <>
            <Input
              value={savingsText}
              onChangeText={setSavingsText}
              keyboardType="decimal-pad"
              placeholder="$0"
              accessibilityLabel="Savings per paycheck"
            />
            <Row style={{ gap: Spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Save"
                  onPress={() => {
                    const v = Number(savingsText.replace(/[^0-9.]/g, ''));
                    if (!Number.isNaN(v)) saveSavings(v);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={`Use automatic (${moneyWhole(p.autoSavings)})`} kind="secondary" onPress={() => saveSavings(null)} />
              </View>
            </Row>
          </>
        )}
        {short && (
          <T variant="small" color={c.warning}>
            That leaves {moneyWhole(p.leftToSpend)} per check, below your usual spending of{' '}
            {moneyWhole(p.spendPerCheck)}. See Budget for ways to cut.
          </T>
        )}
        <ErrorText message={err} />
      </Card>

      {p.plan.fromCash.length > 0 && (
        <Card style={{ backgroundColor: c.warningSoft, borderColor: c.warningSoft }}>
          <T variant="heading">Pay from cash on hand</T>
          <T variant="muted">Due before your next paycheck arrives:</T>
          {p.plan.fromCash.map((b) => (
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
            title={new Date(month + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          />
          {checks.map((check) => (
            <CheckCard key={check.id} check={check} savings={p.savings} typical={p.leftToSpend} />
          ))}
        </View>
      ))}
    </>
  );
}

function CheckCard({ check, savings, typical }: { check: PlannedCheck; savings: number; typical: number }) {
  const c = useTheme();
  // Spending money comes first on a check squeezed by a big bill (groceries
  // still need buying); savings take the cut. Any extra on a roomier check
  // goes to savings.
  const spend = Math.max(0, Math.min(typical, check.leftover));
  const saved = Math.max(0, check.leftover - spend);
  const low = saved < savings - 25;
  const parts = [
    { label: 'Bills', value: check.billsTotal, color: c.textMuted },
    { label: 'Save', value: saved, color: c.saveColor },
    { label: 'Spend', value: Math.max(0, spend), color: c.accent },
  ];
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <T variant="heading" numberOfLines={1}>
            {check.name}
          </T>
          <T variant="small">
            {weekday(check.date)}, {shortDate(check.date)}
          </T>
        </View>
        <T variant="money" color={c.positive} style={{ fontSize: 17 }}>
          +{money(check.amount)}
        </T>
      </Row>

      {/* Where this check goes: bills, savings, spending */}
      <View style={styles.split} accessibilityLabel={`Bills ${money(check.billsTotal)}, save ${money(saved)}, spend ${money(spend)}`}>
        {parts.map((part) =>
          part.value > 0 ? (
            <View key={part.label} style={{ flex: part.value, backgroundColor: part.color, height: '100%' }} />
          ) : null,
        )}
      </View>
      <Row style={{ gap: Spacing.lg }}>
        {parts.map((part) => (
          <Row key={part.label} style={{ gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: part.color }} />
            <T variant="small">
              {part.label} {moneyWhole(part.value)}
            </T>
          </Row>
        ))}
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
      <Divider />
      <Row style={{ justifyContent: 'space-between' }}>
        <T>Move to savings</T>
        <T variant="money" color={c.primary}>
          {money(saved)}
        </T>
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <T style={{ fontWeight: '700' }}>Left to spend</T>
        <T variant="money" style={{ fontSize: 18 }} color={spend < 0 ? c.negative : undefined}>
          {money(spend)}
        </T>
      </Row>
      {low && (
        <T variant="small" color={c.warning}>
          {spend < typical - 25
            ? 'Tight check: a big bill is due before the next paycheck. Nothing to save and less to spend this time.'
            : `Saves less this time (usually ${moneyWhole(savings)}): a big bill is due before the next paycheck.`}
        </T>
      )}
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

function scheduleLabel(s: Pick<IncomeSource, 'frequency' | 'day1' | 'day2' | 'anchor_date'>) {
  switch (s.frequency) {
    case 'weekly':
      return s.anchor_date ? `Every ${weekday(s.anchor_date)}` : 'Every week';
    case 'biweekly':
      return s.anchor_date ? `Every other ${weekday(s.anchor_date)}` : 'Every 2 weeks';
    case 'semimonthly':
      return `The ${ordinal(s.day1 ?? 1)} and ${s.day2 === 31 ? 'last day' : ordinal(s.day2 ?? 15)}`;
    default:
      return s.day1 === 31 ? 'Last day of each month' : `The ${ordinal(s.day1 ?? 1)} of each month`;
  }
}

function IncomeView({ data, reload }: { data: HouseholdData; reload: () => void }) {
  const c = useTheme();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const monthly = data.incomes.reduce((s, x) => s + monthlyAmount(x.frequency, x.amount), 0);
  const detected = data.incomes.some((s) => s.detection_key);

  async function checkNow() {
    setChecking(true);
    setErr(null);
    setResult(null);
    try {
      const r = await callFunction<{ found: number; added: number }>('paychecks-detect');
      setResult(
        r.found === 0
          ? 'No regular paychecks found in the last 7 months of deposits.'
          : `Found ${r.found} paycheck${r.found === 1 ? '' : 's'}${r.added ? `, added ${r.added} new` : ''}.`,
      );
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <Row style={{ gap: Spacing.md, alignItems: 'stretch' }}>
        <Stat label="Expected / month" value={moneyWhole(monthly)} color={c.positive} />
        <Stat label="Paychecks" value={String(data.incomes.length)} />
      </Row>

      <Card style={{ backgroundColor: c.primarySoft, borderColor: c.primarySoft, padding: Spacing.md }}>
        <T>
          Paychecks are found automatically from your bank deposits after every sync: who pays
          you, the average amount, and the days they land, including when a weekend payday comes
          early.
        </T>
        <Button title="Check deposits now" kind="secondary" loading={checking} onPress={checkNow} />
        {result && <T variant="small">{result}</T>}
      </Card>

      <SectionHeader title="Paychecks" action="+ Add" onAction={() => router.push('/income/new')} />
      <Card>
        {data.incomes.length === 0 && (
          <T variant="muted">
            {detected
              ? 'All detected paychecks were removed. Add one by hand, or check deposits again.'
              : 'None found yet. Add each paycheck by hand, e.g. every other Friday, or the 7th and 22nd.'}
          </T>
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
                  <Row style={{ gap: 6, flexShrink: 1 }}>
                    <T style={{ fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
                      {src.name}
                    </T>
                    {src.auto && <Badge text="AUTO" tone="primary" />}
                  </Row>
                  <T variant="money" color={c.positive}>
                    {money(src.amount)}
                  </T>
                </Row>
                <T variant="small">
                  {scheduleLabel(src)}
                  {next ? ` · next ${weekday(next.date)}, ${shortDate(next.date)}` : ''}
                </T>
                {src.detection_key && src.average_amount != null && (
                  <T variant="small">
                    Avg {money(src.average_amount)} over {src.occurrences} deposits
                    {src.last_paid ? ` · last ${money(src.last_amount ?? 0)} on ${shortDate(src.last_paid)}` : ''}
                  </T>
                )}
              </Pressable>
            </View>
          );
        })}
      </Card>
      <ErrorText message={err} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Budget: automatic budgets, fixed vs variable, where to cut
// ---------------------------------------------------------------------------

function BudgetView({ data, reload }: { data: HouseholdData; reload: () => void }) {
  const c = useTheme();
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  const months = trailingMonths(now, data.firstDate);
  const avg = categoryAverages(data.flows, months);
  const billsPerMonth = data.bills.reduce(
    (s, b) => s + monthlyAmount(b.frequency, toBillSchedule(b, data.liabilities).amount),
    0,
  );
  const split = expenseSplit(data.flows, data.categories, months, billsPerMonth);
  const cuts = cutSuggestions(data.flows, data.categories, now, data.firstDate);
  const monthlySavings = cuts.reduce((s, x) => s + x.savings, 0);
  const thisMonth = new Map(spendingByCategory(data.flows, periodMonths(now, 1)).map((x) => [x.categoryId, x.amount]));

  const variableCats = data.categories
    .filter((x) => x.kind === 'expense' && x.expense_type === 'variable')
    .sort((a, b) => (avg.get(b.id) ?? 0) - (avg.get(a.id) ?? 0));
  const fixedCats = data.categories.filter((x) => x.kind === 'expense' && x.expense_type === 'fixed');
  const budgetOf = (id: string) => data.categories.find((k) => k.id === id)?.monthly_budget;

  async function apply(list: typeof cuts, label: string) {
    setApplying(label);
    setErr(null);
    try {
      await setCategoryBudgets(list.map((x) => ({ id: x.categoryId, monthly_budget: x.target })));
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(null);
    }
  }

  async function saveBudget(cat: Category, value: number | null) {
    try {
      if (value == null) await resetCategoryBudget(cat.id);
      else await updateCategoryBudget(cat.id, value);
      setErr(null);
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Row style={{ gap: Spacing.md, alignItems: 'stretch' }}>
        <Stat
          label="Fixed / month"
          value={moneyWhole(split.fixed)}
          sub={split.fromBills ? 'from your bills' : 'rent, utilities, loans…'}
        />
        <Stat label="Variable / month" value={moneyWhole(split.variable)} sub="groceries, dining…" />
      </Row>
      <T variant="small" style={{ marginTop: -Spacing.sm }}>
        Monthly averages over {months.size || 0} complete month{months.size === 1 ? '' : 's'} of bank history.
      </T>

      <SectionHeader title="Where you can cut" />
      <Card>
        {cuts.length === 0 ? (
          <T variant="muted">
            No easy cuts found yet. Suggestions appear once there are at least 3 months of spending
            in flexible categories like dining, shopping and entertainment.
          </T>
        ) : (
          <>
            <View style={[styles.savingsBox, { backgroundColor: c.primarySoft }]}>
              <T variant="small">Cutting where you can saves about</T>
              <T variant="money" color={c.primary} style={{ fontSize: 28, fontWeight: '800' }}>
                {moneyWhole(monthlySavings)}/month
              </T>
              <T variant="small">{moneyWhole(monthlySavings * 12)} a year</T>
            </View>
            {cuts.map((x, i) => {
              const applied = budgetOf(x.categoryId) === x.target;
              return (
                <View key={x.categoryId} style={{ gap: 4 }}>
                  {i > 0 && <Divider />}
                  <Row style={{ justifyContent: 'space-between', marginTop: i > 0 ? Spacing.sm : 0 }}>
                    <T style={{ fontWeight: '600' }}>{x.name}</T>
                    <T variant="money" color={c.positive}>
                      save {moneyWhole(x.savings)}/mo
                    </T>
                  </Row>
                  <T variant="small">
                    Average {moneyWhole(x.average)} → {moneyWhole(x.target)} · {x.reason}
                  </T>
                  <T variant="small" color={c.text}>
                    💡 {x.tip}
                  </T>
                  <Row style={{ justifyContent: 'flex-end' }}>
                    <Pressable
                      disabled={applied || applying != null}
                      onPress={() => apply([x], x.categoryId)}
                      hitSlop={8}>
                      <T variant="small" color={applied ? c.textSecondary : c.primary} style={{ fontWeight: '700' }}>
                        {applied ? 'Budget set ✓' : `Set budget to ${moneyWhole(x.target)}`}
                      </T>
                    </Pressable>
                  </Row>
                </View>
              );
            })}
            <Button
              title="Use all of these as my budgets"
              onPress={() => apply(cuts, 'all')}
              loading={applying === 'all'}
              disabled={cuts.every((x) => budgetOf(x.categoryId) === x.target)}
            />
          </>
        )}
      </Card>

      <SectionHeader title="Variable spending budgets" />
      <Card>
        <T variant="muted">
          Set automatically to your 12-month average and kept up to date. Type an amount to set your
          own; clear it to go back to automatic.
        </T>
        {variableCats.map((cat, i) => (
          <BudgetRow key={cat.id} cat={cat} index={i} spent={thisMonth.get(cat.id) ?? 0} average={avg.get(cat.id) ?? 0} onSave={saveBudget} />
        ))}
      </Card>

      <SectionHeader title="Fixed expenses" />
      <Card>
        <T variant="muted">
          {split.fromBills
            ? 'Planned from your bills. Average actual spending per month:'
            : 'Add these as bills in the Bills tab so the paycheck plan can schedule them. Average spending per month:'}
        </T>
        {fixedCats
          .filter((cat) => (avg.get(cat.id) ?? 0) > 0)
          .map((cat) => (
            <Row key={cat.id} style={{ justifyContent: 'space-between' }}>
              <T>{cat.name}</T>
              <T variant="money">{money(avg.get(cat.id) ?? 0)}</T>
            </Row>
          ))}
      </Card>
      <ErrorText message={err} />
    </>
  );
}

function BudgetRow({
  cat,
  index,
  spent,
  average,
  onSave,
}: {
  cat: Category;
  index: number;
  spent: number;
  average: number;
  onSave: (cat: Category, value: number | null) => void;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: Spacing.sm }}>
      {index > 0 && <Divider />}
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Row style={{ gap: 6 }}>
            <T>{cat.name}</T>
            {cat.budget_auto && cat.monthly_budget != null && <Badge text="AUTO" tone="primary" />}
          </Row>
          <T variant="small">
            {money(spent)} this month · avg {moneyWhole(average)}
          </T>
        </View>
        <BudgetInput cat={cat} onSave={onSave} />
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
      placeholder="Auto"
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
  split: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 },
  track: { height: 8, borderRadius: 4 },
  savingsBox: { borderRadius: Radius.md, padding: Spacing.lg, gap: 2, alignItems: 'center' },
});
