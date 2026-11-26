import {
  Account,
  Bill,
  Category,
  ExpectedIncome,
  fetchAccounts,
  fetchBills,
  fetchCategories,
  fetchExpectedIncome,
  fetchFirstTransactionDate,
  fetchIncomeSources,
  fetchLiabilities,
  fetchMonthlyFlows,
  fetchPlanRules,
  fetchPlanSavings,
  PlanRuleRow,
  PlanSavingRow,
  FlowRow,
  IncomeSource,
  Liability,
  refreshAutoBudgets,
  useQuery,
} from './data';
import { BillLike, expenseBreakdown, monthStart, trailingMonths } from './insights';
import { currentBalance, payoff } from './debt';
import { budgetCommission } from './taxes';
import {
  addDays,
  BillSchedule,
  buildPaycheckPlan,
  endOfMonth,
  IncomeEdit,
  monthlyAmount,
  paydays,
  PaySchedule,
  today,
} from './schedule';

export interface HouseholdData {
  accounts: Account[];
  categories: Category[];
  flows: FlowRow[];
  firstDate: string | null;
  incomes: IncomeSource[];
  bills: Bill[];
  liabilities: Liability[];
  /** Commission/bonus amounts and extra income, today through next month. */
  expected: ExpectedIncome[];
  /** Your own paycheck plan (which paycheck pays which bill). */
  planRules: PlanRuleRow[];
  /** What you save from each check in My plan. */
  planSavings: PlanSavingRow[];
}

const EMPTY: HouseholdData = {
  accounts: [],
  categories: [],
  flows: [],
  firstDate: null,
  incomes: [],
  bills: [],
  liabilities: [],
  expected: [],
  planRules: [],
  planSavings: [],
};

/** Everything the Overview and Plan tabs need, reloaded on focus. */
export function useHouseholdData() {
  return useQuery<HouseholdData>(async () => {
    // Keep automatic budgets at the latest 12-month average. It runs alongside
    // everything else instead of first; categories are only fetched again if
    // a budget actually changed.
    const budgets = refreshAutoBudgets().catch(() => 0);
    const [accounts, firstCategories, flows, firstDate, incomes, bills, liabilities, expected, planRules, planSavings] = await Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchMonthlyFlows(monthStart(new Date(), -12)),
      fetchFirstTransactionDate(),
      fetchIncomeSources(),
      fetchBills(),
      fetchLiabilities(),
      // Through next month: the paycheck plan looks that far ahead.
      fetchExpectedIncome(today(), endOfMonth(addDays(endOfMonth(today()), 1))),
      fetchPlanRules(),
      fetchPlanSavings().catch(() => []),
    ]);
    const categories = (await budgets) > 0 ? await fetchCategories() : firstCategories;
    return { accounts, categories, flows, firstDate, incomes, bills, liabilities, expected, planRules, planSavings };
  }, EMPTY, '', 'household');
}

/** Cash in checking/savings and what's owed on cards (visible accounts). */
export function balances(accounts: Account[]) {
  const visible = accounts.filter((a) => !a.hidden);
  const cash = visible
    .filter((a) => a.type === 'depository')
    .reduce((s, a) => s + (a.balance_available ?? a.balance_ledger ?? 0), 0);
  const cardAccounts = visible.filter((a) => a.type === 'credit');
  const cards = cardAccounts.reduce((s, a) => s + (a.balance_ledger ?? 0), 0);
  return { cash, cards, cardAccounts };
}

export const toPaySchedule = (s: IncomeSource): PaySchedule => s;

/**
 * A bill as the planner sees it. Bills linked to a connected card or loan use
 * the bank's minimum payment when no amount is entered.
 */
export function toBillSchedule(bill: Bill, liabilities: Liability[]): BillSchedule {
  const l = bill.account_id ? liabilities.find((x) => x.account_id === bill.account_id) : undefined;
  return {
    id: bill.id,
    name: bill.name,
    amount: bill.amount ?? l?.minimum_payment ?? 0,
    frequency: bill.frequency,
    due_day: bill.due_day,
    due_month: bill.due_month,
  };
}

/**
 * Balance, APR and payoff for a debt. Connected accounts use the lender's
 * balance; debts you entered pay down month by month from the balance you
 * gave (same math as net worth).
 */
export function debtDetails(bill: Bill, accounts: Account[], liabilities: Liability[]) {
  const account = bill.account_id ? accounts.find((a) => a.id === bill.account_id) : undefined;
  const l = bill.account_id ? liabilities.find((x) => x.account_id === bill.account_id) : undefined;
  const payment = bill.amount ?? l?.minimum_payment ?? null;
  const apr = bill.apr ?? l?.apr ?? null;
  const balance = account
    ? Math.abs(account.balance_ledger ?? 0)
    : currentBalance({
        balance: bill.balance,
        apr: bill.apr,
        payment: bill.amount,
        balanceDate: bill.balance_date,
        dueDay: bill.due_day,
        today: today(),
      });
  const monthlyInterest = balance != null && apr != null ? (balance * apr) / 100 / 12 : null;
  const plan = balance != null && payment != null && apr != null ? payoff(balance, apr, payment, today()) : null;
  return { account, balance, apr, payment, monthlyInterest, payoff: plan, linked: !!account };
}

export interface IncomingCheck {
  key: string;
  name: string;
  date: string;
  amount: number;
  /** The paycheck schedule this comes from (null: extra income you added). */
  sourceId: string | null;
  /** Your edit for this check, if any. */
  expected: ExpectedIncome | null;
  /** What the schedule says, before your edit. */
  scheduled: number | null;
}

/**
 * Paychecks from `from` through `to`, with your edits applied: an edited
 * check shows your amount (e.g. this month's commission), and extra income
 * you added appears on its date.
 */
export function incomingChecks(
  incomes: IncomeSource[],
  expected: ExpectedIncome[],
  from: string,
  to: string,
): IncomingCheck[] {
  const used = new Set<string>();
  const out: IncomingCheck[] = [];
  for (const src of incomes) {
    for (const p of paydays(src, from, to)) {
      const edit = expected.find((e) => e.income_source_id === src.id && e.pay_date === p.date);
      if (edit) used.add(edit.id);
      out.push({
        key: p.id,
        name: src.name,
        date: p.date,
        amount: edit ? edit.amount : p.amount,
        sourceId: src.id,
        expected: edit ?? null,
        scheduled: p.amount,
      });
    }
  }
  for (const e of expected) {
    if (used.has(e.id) || e.pay_date < from || e.pay_date > to) continue;
    out.push({ key: e.id, name: e.name, date: e.pay_date, amount: e.amount, sourceId: null, expected: e, scheduled: null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Bills that are real spending, as monthly amounts. Payments to a credit
 * card are left out: the card's purchases already count as spending.
 */
export function expenseBills(bills: Bill[], accounts: Account[], liabilities: Liability[]): BillLike[] {
  const cards = new Set(accounts.filter((a) => a.type === 'credit').map((a) => a.id));
  return bills
    .filter((b) => !(b.account_id && cards.has(b.account_id)))
    .map((b) => ({
      id: b.id,
      name: b.name,
      monthly: monthlyAmount(b.frequency, toBillSchedule(b, liabilities).amount),
      category_id: b.category_id,
      expense_type: b.expense_type ?? 'fixed',
    }));
}

/** Your saved edits in the shape the paycheck planner takes. */
export function incomeEdits(expected: ExpectedIncome[]): IncomeEdit[] {
  return expected.map((e) => ({
    id: e.id,
    sourceId: e.income_source_id,
    date: e.pay_date,
    name: e.name,
    amount: e.amount,
  }));
}

/**
 * Money in vs out each month, the same everywhere it's shown:
 * income = your paychecks (Plan > Income) + slow-month commission after taxes;
 * expenses = fixed + variable (budgets where set, averages elsewhere).
 */
export function monthlyCashFlow(
  data: HouseholdData,
  household: {
    commission_low: number | null;
    commission_high: number | null;
    tax_state: string | null;
    retirement_pct: number;
  } | null,
) {
  const commission = budgetCommission({
    low: household?.commission_low ?? null,
    high: household?.commission_high ?? null,
    state: household?.tax_state ?? null,
    retirementPct: household?.retirement_pct ?? 0,
  });
  const paychecks = data.incomes.reduce((s, x) => s + monthlyAmount(x.frequency, x.amount), 0);
  const split = expenseBreakdown(
    data.flows,
    data.categories,
    trailingMonths(new Date(), data.firstDate),
    expenseBills(data.bills, data.accounts, data.liabilities),
  );
  const income = paychecks + commission.net;
  const expenses = split.fixed.total + split.variable.total;
  return { paychecks, commission, income, split, expenses, net: income - expenses };
}

// ---------------------------------------------------------------------------
// Paycheck plan (Plan tab and the Overview's "Rest of this month")
// ---------------------------------------------------------------------------

/** Inputs every plan shares: your paychecks, fixed bills and entered commission. */
export function planInputs(data: HouseholdData) {
  const from = today();
  const to = endOfMonth(addDays(endOfMonth(from), 1)); // through end of next month
  // Only your fixed expenses: the same bills as the Fixed list (credit card
  // payments aren't included; the card's purchases are spending).
  const fixedIds = new Set(
    expenseBills(data.bills, data.accounts, data.liabilities)
      .filter((b) => b.expense_type === 'fixed')
      .map((b) => b.id),
  );
  const fixed = data.bills.filter((b) => fixedIds.has(b.id));
  return {
    from,
    to,
    fixed,
    schedules: fixed.map((b) => toBillSchedule(b, data.liabilities)),
    // Commission and other amounts you entered for upcoming paydays.
    edits: incomeEdits(data.expected),
  };
}

/** Your paycheck plan: automatic (even), or My plan (only the bills you placed). */
export function householdPlan(data: HouseholdData, mode: 'even' | 'mine') {
  const { from, to, fixed, schedules, edits } = planInputs(data);
  const rules =
    mode === 'mine'
      ? data.planRules.map((r) => ({
          id: r.id,
          billId: r.bill_id,
          sourceId: r.income_source_id,
          amount: r.amount,
          slot: r.check_slot,
          fraction: r.fraction,
        }))
      : [];
  const savings =
    mode === 'mine'
      ? data.planSavings.map((sv) => ({
          id: sv.id,
          sourceId: sv.income_source_id,
          slot: sv.check_slot,
          amount: sv.amount,
          percent: sv.percent,
        }))
      : [];
  const plan = buildPaycheckPlan(data.incomes, schedules, from, to, edits, rules, {
    onlyRules: mode === 'mine',
    savings,
  });
  return { plan, fixed };
}
