import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import PlaidLink from '@/components/plaid-link';
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorText,
  GradientCard,
  IconBubble,
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
import { confirmAction } from '@/lib/confirm';
import {
  Category,
  detectRecurring,
  IncomeSource,
  resetCategoryBudget,
  clearPlanRules,
  markBudgetHelpDone,
  setPlanMode,
  setCategoryBudgets,
  updateCategoryBudget,
} from '@/lib/data';
import { money, moneyWhole, monthShort, ordinal, shortDate, weekday } from '@/lib/format';
import {
  debtDetails,
  expenseBills,
  HouseholdData,
  incomeEdits,
  toBillSchedule,
  useHouseholdData,
} from '@/lib/household-data';
import {
  budgetHelpDue,
  categoryAverages,
  cutSuggestions,
  expenseBreakdown,
  monthStart,
  periodMonths,
  spendingByCategory,
  trailingMonths,
  withoutBills,
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
import { billEmoji, categoryEmoji } from '@/lib/visuals';

type Section = 'plan' | 'bills' | 'income' | 'budget';
const SECTIONS: { value: Section; label: string }[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'bills', label: 'Bills' },
  { value: 'income', label: 'Income' },
  { value: 'budget', label: 'Budget' },
];

export default function PlanScreen() {
  // Links can open a section directly, e.g. /plan?section=budget.
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>('plan');
  const { data, loading, error, reload } = useHouseholdData();
  useEffect(() => {
    const wanted = SECTIONS.find((x) => x.value === params.section);
    if (wanted) setSection(wanted.value);
  }, [params.section]);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <T variant="title" style={{ marginTop: Spacing.sm }}>
        Plan
      </T>
      <Segmented options={SECTIONS} value={section} onChange={setSection} />
      <ErrorText message={error} />
      {section === 'plan' && <PaycheckPlanView data={data} goTo={setSection} reload={reload} />}
      {section === 'bills' && <BillsView data={data} reload={reload} />}
      {section === 'income' && <IncomeView data={data} reload={reload} />}
      {section === 'budget' && <BudgetView data={data} reload={reload} />}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Paycheck plan: bills, then the same savings and spending money every check
// ---------------------------------------------------------------------------

function usePlan(data: HouseholdData, mode: 'even' | 'mine') {
  return useMemo(() => {
    const from = today();
    const to = endOfMonth(addDays(endOfMonth(from), 1)); // through end of next month
    // Only your fixed expenses: the same bills as the Fixed list (credit card
    // payments aren't included; the card's purchases are spending).
    const fixedIds = new Set(
      expenseBills(data.bills, data.accounts, data.liabilities)
        .filter((b) => b.expense_type === 'fixed')
        .map((b) => b.id),
    );
    const rules =
      mode === 'mine'
        ? data.planRules.map((r) => ({ billId: r.bill_id, sourceId: r.income_source_id, amount: r.amount }))
        : [];
    const plan = buildPaycheckPlan(
      data.incomes,
      data.bills.filter((b) => fixedIds.has(b.id)).map((b) => toBillSchedule(b, data.liabilities)),
      from,
      to,
      // Commission and other amounts you entered for upcoming paydays.
      incomeEdits(data.expected),
      rules,
    );
    return { plan };
  }, [data, mode]);
}

function PaycheckPlanView({
  data,
  goTo,
  reload,
}: {
  data: HouseholdData;
  goTo: (s: Section) => void;
  reload: () => void;
}) {
  const c = useTheme();
  const { household, refreshHousehold } = useAuth();
  const mode = household?.plan_mode ?? 'even';
  const p = usePlan(data, mode);
  const [modeErr, setModeErr] = useState<string | null>(null);
  const ruleCount = new Set(data.planRules.map((r) => r.bill_id)).size;

  async function changeMode(next: 'even' | 'mine') {
    if (!household || next === mode) return;
    try {
      await setPlanMode(household.id, next);
      await refreshHousehold();
      setModeErr(null);
    } catch (e) {
      setModeErr(e instanceof Error ? e.message : String(e));
    }
  }

  function resetMine() {
    if (!household) return;
    confirmAction('Start your plan over?', 'Every bill goes back to being placed automatically.', 'Start over', async () => {
      try {
        await clearPlanRules(household.id);
        reload();
      } catch (e) {
        setModeErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (!data.incomes.length || !data.bills.length) {
    return (
      <Card>
        <T variant="heading">Build your paycheck plan</T>
        <T variant="muted">
          Once your paychecks and fixed bills are in, the plan pays each bill in full from one
          paycheck, arranged so every check keeps about the same amount. Paychecks are found
          automatically from your bank deposits.
        </T>
        {!data.incomes.length && <Button title="Add paychecks" onPress={() => goTo('income')} />}
        {!data.bills.length && <Button title="Add bills" kind="secondary" onPress={() => goTo('bills')} />}
      </Card>
    );
  }

  const byMonth = new Map<string, PlannedCheck[]>();
  for (const check of p.plan.checks) {
    const key = startOfMonth(check.date);
    byMonth.set(key, [...(byMonth.get(key) ?? []), check]);
  }
  const lefts = p.plan.checks.map((x) => x.leftover);
  const minLeft = Math.min(...lefts);
  const maxLeft = Math.max(...lefts);
  const fixedTotal = p.plan.checks.reduce((s2, x) => s2 + x.billsTotal, 0);

  return (
    <>
      <Segmented
        options={[
          { value: 'even', label: '⚖️ Even (automatic)' },
          { value: 'mine', label: '✋ My plan' },
        ]}
        value={mode}
        onChange={changeMode}
      />
      <ErrorText message={modeErr} />

      <GradientCard colors={c.gradPlan}>
        <T color={c.heroMuted} style={styles.summaryLabel}>
          LEFT ON EACH CHECK AFTER FIXED BILLS
        </T>
        <T color={c.heroText} style={styles.summaryValue}>
          {!lefts.length ? '—' : maxLeft - minLeft < 1 ? moneyWhole(maxLeft) : `${moneyWhole(minLeft)} – ${moneyWhole(maxLeft)}`}
        </T>
        <T color={c.heroMuted}>
          {mode === 'even'
            ? `Your fixed bills (${moneyWhole(fixedTotal)}) are divided across your ${p.plan.checks.length} checks so every check keeps the same amount. A bill is split between checks when needed, and always paid from checks that arrive before it's due.`
            : `Bills you've placed (${ruleCount}) are paid from the paycheck you chose. The rest are divided automatically so the other checks stay as even as possible. Tap any bill to change where it comes from.`}
        </T>
      </GradientCard>

      {mode === 'mine' && ruleCount > 0 && (
        <Button title="Start my plan over" kind="secondary" onPress={resetMine} />
      )}

      {p.plan.smallIncome.length > 0 && (
        <T variant="small">
          Small deposits ({[...new Set(p.plan.smallIncome.map((x) => x.name))].join(', ')}) aren&apos;t used for bills.
        </T>
      )}

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
            <CheckCard key={check.id} check={check} editable={mode === 'mine'} />
          ))}
        </View>
      ))}
    </>
  );
}

function CheckCard({ check, editable }: { check: PlannedCheck; editable: boolean }) {
  const c = useTheme();
  const left = check.leftover;
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <T variant="heading" numberOfLines={1}>
            {check.name}
          </T>
          <T variant="small">
            {weekday(check.date)}, {shortDate(check.date)}
            {check.edited ? ' · 💼 your amount' : ''}
          </T>
        </View>
        <T variant="money" color={c.positive} style={{ fontSize: 17 }}>
          +{money(check.amount)}
        </T>
      </Row>

      {/* Fixed bills vs what's left */}
      <View
        style={styles.split}
        accessibilityLabel={`Fixed bills ${money(check.billsTotal)}, left ${money(left)}`}>
        {check.billsTotal > 0 && (
          <View style={{ flex: check.billsTotal, backgroundColor: c.textMuted, height: '100%' }} />
        )}
        {left > 0 && <View style={{ flex: left, backgroundColor: c.accent, height: '100%' }} />}
      </View>

      {left < 0 && (
        <T variant="small" color={c.negative} style={{ fontWeight: '600' }}>
          ⚠️ {money(-left)} short: a bill here is bigger than this check. Cover it from savings or the previous
          check&apos;s leftover.
        </T>
      )}

      {check.bills.length === 0 && <T variant="muted">No fixed bills from this check.</T>}
      {check.bills.map((b) => (
        <Pressable
          key={b.id}
          disabled={!editable}
          accessibilityRole={editable ? 'button' : undefined}
          accessibilityLabel={editable ? `Choose how ${b.name} is paid` : undefined}
          onPress={() => router.push({ pathname: '/plan-bill/[id]', params: { id: b.refId } })}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flexShrink: 1 }}>
            <T numberOfLines={1}>
              {b.name}
              {b.custom ? ' ✋' : ''}
              {editable ? <T variant="small" color={c.primary}>  ✎</T> : null}
            </T>
            <T variant="small">
              {b.split
                ? `${money(b.amount)} of ${money(b.fullAmount)} · due ${shortDate(b.date)}`
                : `Due ${shortDate(b.date)} · paid in full`}
            </T>
          </View>
          <T variant="money">−{money(b.amount)}</T>
        </Row>
        </Pressable>
      ))}
      <Divider />
      <Row style={{ justifyContent: 'space-between' }}>
        <T style={{ fontWeight: '700' }}>Left after fixed bills</T>
        <T variant="money" style={{ fontSize: 18 }} color={left < 0 ? c.negative : undefined}>
          {money(left)}
        </T>
      </Row>
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

  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  async function checkBills() {
    setChecking(true);
    setErr(null);
    setFound(null);
    try {
      const r = await detectRecurring();
      const n = r.bills?.found ?? 0;
      const added = r.bills?.added ?? 0;
      setFound(
        n === 0 && added === 0
          ? 'No regular monthly payments found yet. They show up after about 3 months of history.'
          : `Found ${n} regular payment${n === 1 ? '' : 's'}${added ? `, added ${added} new` : ''}.`,
      );
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

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
        <Stat label="Bills / mo" icon="🧾" accent="#2A78D6" value={moneyWhole(monthlyBills)} />
        <Stat label="Debt" icon="🏦" accent="#6250D6" value={moneyWhole(totalDebt)} />
        <Stat
          label="Interest"
          icon="🔥"
          accent="#E34948"
          value={moneyWhole(interest)}
          sub="per month"
          color={interest > 0 ? c.negative : undefined}
        />
      </Row>

      <Row style={{ gap: Spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="+ Add a bill or monthly payment" onPress={() => router.push('/bill/new')} />
        </View>
      </Row>
      <Button title="🔍 Find bills in my bank activity" kind="secondary" loading={checking} onPress={checkBills} />
      {found && <T variant="small">{found}</T>}

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

      <SectionHeader title="Bills & debts" action="+ Add" onAction={() => router.push('/bill/new')} />
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
                <Row style={{ gap: Spacing.sm, flexShrink: 1 }}>
                  <IconBubble
                    emoji={billEmoji(
                      { ...bill, account_type: debt.account?.type },
                      data.categories.find((k) => k.id === bill.category_id),
                    )}
                    color={bill.is_debt ? '#6250D6' : '#2A78D6'}
                  />
                  <View style={{ flexShrink: 1, gap: 2 }}>
                    <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                      <T numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }}>
                        {bill.name}
                      </T>
                      {bill.is_debt && <Badge text="DEBT" tone="warning" />}
                      {debt.linked && <Badge text="SYNCED" tone="primary" />}
                      {bill.auto && <Badge text="AUTO" tone="primary" />}
                    </Row>
                    <T variant="small">
                      {frequencyLabel(bill.frequency, bill.due_day, bill.due_month)}
                      {bill.amount == null && debt.linked ? ' · minimum payment' : ''}
                    </T>
                  </View>
                </Row>
                <T variant="money">{money(schedule.amount)}</T>
              </Row>
              {bill.is_debt && (
                <View style={{ paddingLeft: 44, gap: 4 }}>
                  <T variant="small">
                    Owe {debt.balance != null ? money(debt.balance) : '— (add the balance)'}
                    {debt.apr != null ? ` · ${debt.apr}% APR` : debt.linked ? '' : ' · add the rate'}
                  </T>
                  {debt.payoff && debt.payoff.months != null && debt.balance != null && debt.balance > 0 && (
                    <>
                      <T variant="small" style={{ fontWeight: '700' }} color={c.text}>
                        🏁 Paid off{' '}
                        {new Date(debt.payoff.payoffDate + '-01T12:00:00').toLocaleDateString('en-US', {
                          month: 'short',
                          year: 'numeric',
                        })}{' '}
                        · {debt.payoff.months} payments to go
                      </T>
                      <T variant="small">
                        {money(debt.payoff.nextPrincipal)} of the next payment lowers the balance;{' '}
                        {money(debt.payoff.nextInterest)} is interest. ~{money(debt.payoff.interest)} interest left.
                      </T>
                    </>
                  )}
                  {debt.payoff && debt.payoff.months == null && (
                    <T variant="small" color={c.negative}>
                      The payment doesn&apos;t cover the interest; this balance won&apos;t go down.
                    </T>
                  )}
                </View>
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
      const r = await detectRecurring();
      const n = r.paychecks?.found ?? 0;
      const added = r.paychecks?.added ?? 0;
      setResult(
        n === 0
          ? 'No regular paychecks found in the last 7 months of deposits.'
          : `Found ${n} paycheck${n === 1 ? '' : 's'}${added ? `, added ${added} new` : ''}.`,
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
        <Stat label="Expected / month" icon="💰" accent="#1BAF7A" value={moneyWhole(monthly)} color={c.positive} />
        <Stat label="Paychecks" icon="🗓️" accent="#2A78D6" value={String(data.incomes.length)} />
      </Row>

      <Card style={{ backgroundColor: c.primarySoft, borderColor: c.primarySoft, padding: Spacing.md }}>
        <T>
          Paychecks are found automatically from your bank deposits after every sync: who pays
          you, the average amount, and the days they land, including when a weekend payday comes
          early.
        </T>
        <Button title="🔍 Check deposits now" kind="secondary" loading={checking} onPress={checkNow} />
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
                    <IconBubble emoji="💰" color="#1BAF7A" size={30} />
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
  const { household, refreshHousehold } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [justSet, setJustSet] = useState(false);
  const now = useMemo(() => new Date(), []);

  const months = trailingMonths(now, data.firstDate);
  const avg = categoryAverages(withoutBills(data.flows), months);
  const split = expenseBreakdown(
    data.flows,
    data.categories,
    months,
    expenseBills(data.bills, data.accounts, data.liabilities),
  );
  const hasBills = data.bills.length > 0;
  const cuts = cutSuggestions(data.flows, data.categories, now, data.firstDate);
  const monthlySavings = cuts.reduce((s, x) => s + x.savings, 0);
  const thisMonth = new Map(spendingByCategory(data.flows, periodMonths(now, 1)).map((x) => [x.categoryId, x.amount]));

  const variableCats = data.categories
    .filter((x) => x.kind === 'expense' && x.expense_type === 'variable')
    .sort((a, b) => (avg.get(b.id) ?? 0) - (avg.get(a.id) ?? 0));
  const fixedCats = data.categories.filter((x) => x.kind === 'expense' && x.expense_type === 'fixed');
  const budgetOf = (id: string) => data.categories.find((k) => k.id === id)?.monthly_budget;

  const budgets = new Map(data.categories.map((k) => [k.id, k.monthly_budget]));
  const helpDue = budgetHelpDue(cuts, budgets, household?.budget_help_month ?? null, now);
  const nextFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });

  async function apply(list: typeof cuts, label: string) {
    setApplying(label);
    setErr(null);
    try {
      await setCategoryBudgets(list.map((x) => ({ id: x.categoryId, monthly_budget: x.target })));
      // Took them all: hide the suggestions until the 1st of next month.
      if (label === 'all' && household) {
        await markBudgetHelpDone(household.id, monthStart(now));
        await refreshHousehold();
        setJustSet(true);
      }
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
          icon="📌"
          accent="#6250D6"
          value={moneyWhole(split.fixed.total)}
          sub="tap to see & edit"
          onPress={() => router.push('/expenses/fixed')}
        />
        <Stat
          label="Variable / month"
          icon="🛒"
          accent="#EDA100"
          value={moneyWhole(split.variable.total)}
          sub="tap to see & edit"
          onPress={() => router.push('/expenses/variable')}
        />
      </Row>
      <T variant="small" style={{ marginTop: -Spacing.sm }}>
        Monthly averages over {months.size || 0} complete month{months.size === 1 ? '' : 's'} of bank history.
      </T>

      {justSet && !helpDue && (
        <Card style={{ backgroundColor: c.primarySoft, borderColor: c.primarySoft }}>
          <T style={{ fontWeight: '700' }} color={c.primary}>
            ✓ Budgets set for {now.toLocaleDateString('en-US', { month: 'long' })}
          </T>
          <T variant="small">
            Saving about {moneyWhole(monthlySavings)} a month. New suggestions on {nextFirst}.
          </T>
        </Card>
      )}

      {(helpDue || (cuts.length === 0 && !justSet)) && (
      <>
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
                    <T style={{ fontWeight: '600' }}>
                      {categoryEmoji(data.categories.find((k) => k.id === x.categoryId))} {x.name}
                    </T>
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
      </>
      )}

      <SectionHeader title="Variable spending budgets" action="Categories" onAction={() => router.push('/categories')} />
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
          {hasBills
            ? 'Planned from your bills. Average actual spending per month:'
            : 'Add these as bills in the Bills tab so the paycheck plan can schedule them. Average spending per month:'}
        </T>
        {fixedCats
          .filter((cat) => (avg.get(cat.id) ?? 0) > 0)
          .map((cat) => (
            <Row key={cat.id} style={{ justifyContent: 'space-between' }}>
              <Row style={{ gap: Spacing.sm }}>
                <IconBubble emoji={categoryEmoji(cat)} color={cat.color} size={30} />
                <T>{cat.name}</T>
              </Row>
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
          <Row style={{ gap: Spacing.sm }}>
            <IconBubble emoji={categoryEmoji(cat)} color={cat.color} size={30} />
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
              backgroundColor: spent > cat.monthly_budget ? c.negative : cat.color,
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
