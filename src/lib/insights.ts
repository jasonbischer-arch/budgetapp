// Turns monthly money-flow totals into the numbers the app shows: trailing
// averages, period totals, spending by category, and where to cut.
// Pure functions so they're easy to test.

export interface FlowRowLike {
  month: string; // YYYY-MM-01
  flow: 'income' | 'spending' | 'refund' | 'saved';
  category_id: string | null;
  /** Payments that belong to a bill: counted as the bill, never again in a category. */
  bill_id?: string | null;
  total: number; // signed: spending/saved negative, income/refund positive
}

export interface CategoryLike {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'transfer' | 'savings';
  expense_type?: 'fixed' | 'variable';
  provider_categories: string[];
  monthly_budget: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** First day of the month `offset` months from the given date's month. */
export function monthStart(date: Date, offset = 0): string {
  const d = new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

export interface Totals {
  income: number;
  spent: number; // net of refunds, positive
  saved: number; // positive
  net: number; // income - spent
}

export function totalsFor(rows: FlowRowLike[], months: Set<string>): Totals {
  let income = 0;
  let spent = 0;
  let saved = 0;
  for (const r of rows) {
    if (!months.has(r.month)) continue;
    if (r.flow === 'income') income += r.total;
    else if (r.flow === 'spending' || r.flow === 'refund') spent -= r.total;
    else if (r.flow === 'saved') saved -= r.total;
  }
  return { income, spent, saved, net: income - spent };
}

/** The months in a period ending with the current month. */
export function periodMonths(now: Date, count: number): Set<string> {
  return new Set(Array.from({ length: count }, (_, i) => monthStart(now, -i)));
}

/**
 * Average monthly income/spending/saving over the last 12 complete months.
 * Only months the bank history fully covers count: the current month is
 * partial, and so is the month the history starts in unless it starts in its
 * first few days.
 */
/** The complete months (up to 12) that the bank history fully covers. */
export function trailingMonths(now: Date, firstDate: string | null): Set<string> {
  let firstFull = monthStart(now, -12);
  if (firstDate) {
    const startsEarly = Number(firstDate.slice(8)) <= 3;
    const firstCovered = startsEarly ? firstDate.slice(0, 8) + '01' : nextMonth(firstDate);
    if (firstCovered > firstFull) firstFull = firstCovered;
  }
  const current = monthStart(now);
  const months = new Set<string>();
  for (let i = 1; i <= 12; i++) {
    const m = monthStart(now, -i);
    if (m >= firstFull && m < current) months.add(m);
  }
  return months;
}

export function trailingAverages(rows: FlowRowLike[], now: Date, firstDate: string | null) {
  const months = trailingMonths(now, firstDate);
  const t = totalsFor(rows, months);
  const n = months.size;
  return {
    months: n,
    income: n ? t.income / n : 0,
    spent: n ? t.spent / n : 0,
    saved: n ? t.saved / n : 0,
  };
}

function nextMonth(date: string) {
  const [y, m] = date.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}

/** Rows without bill payments: what's left for categories once bills are counted. */
export const withoutBills = <R extends FlowRowLike>(rows: R[]) => rows.filter((r) => !r.bill_id);

/** Net spending per category (refunds subtracted) over a set of months. */
export function spendingByCategory(rows: FlowRowLike[], months: Set<string>) {
  const byCat = new Map<string | null, number>();
  for (const r of rows) {
    if (!months.has(r.month) || (r.flow !== 'spending' && r.flow !== 'refund')) continue;
    byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) - r.total);
  }
  return [...byCat.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .filter((c) => c.amount > 0.5)
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Fixed vs variable expenses
// ---------------------------------------------------------------------------

/** Average monthly spending per category over the trailing complete months. */
export function categoryAverages(rows: FlowRowLike[], months: Set<string>) {
  const n = months.size || 1;
  return new Map(spendingByCategory(rows, months).map((x) => [x.categoryId, x.amount / n]));
}

/**
 * Fixed vs variable monthly expenses. Fixed uses your bills when you've
 * entered them (they're exact); otherwise the average of fixed categories.
 */
export function expenseSplit(
  rows: FlowRowLike[],
  categories: CategoryLike[],
  months: Set<string>,
  billsPerMonth: number,
) {
  const avg = categoryAverages(rows, months);
  let fixedFromSpending = 0;
  let variable = 0;
  for (const [id, amount] of avg) {
    const cat = categories.find((c) => c.id === id);
    if (cat?.expense_type === 'fixed') fixedFromSpending += amount;
    else variable += amount; // includes uncategorized
  }
  const fixed = billsPerMonth > 0 ? billsPerMonth : fixedFromSpending;
  return { fixed, variable, fromBills: billsPerMonth > 0 };
}

export interface BillLike {
  id: string;
  name: string;
  /** Monthly amount. */
  monthly: number;
  category_id: string | null;
  expense_type: 'fixed' | 'variable';
}

export interface ExpenseItem {
  kind: 'bill' | 'category';
  id: string | null; // category id may be null (uncategorized)
  name: string;
  /** What it counts as per month: a category's budget when set, else its average. */
  monthly: number;
  /** Categories: 12-month average actually spent (bill payments left out). */
  average?: number;
  /** Categories: true when `monthly` is the budget you set. */
  budgeted?: boolean;
}

/**
 * Fixed and variable expenses, item by item, with no double counting.
 * Fixed is exactly your fixed bills. Variable is your variable bills plus
 * each variable category's 12-month average, less any bills paid from it
 * (e.g. Entertainment $60 with a $20 Netflix bill adds $40).
 *
 * Pass only bills that are real spending: payments to a credit card are
 * left out by the caller, since the card's purchases are already counted.
 */
export function expenseBreakdown(
  rows: FlowRowLike[],
  categories: CategoryLike[],
  months: Set<string>,
  bills: BillLike[],
) {
  // Payments linked to a bill count as that bill only.
  const avg = categoryAverages(withoutBills(rows), months);
  const linked = new Set(rows.filter((r) => r.bill_id && months.has(r.month)).map((r) => r.bill_id));
  // A bill with no matched payments (e.g. named differently from the
  // payee): fall back to taking its amount out of its category.
  const estimatedByCat = new Map<string | null, number>();
  for (const b of bills) {
    if (b.category_id && !linked.has(b.id)) {
      estimatedByCat.set(b.category_id, (estimatedByCat.get(b.category_id) ?? 0) + b.monthly);
    }
  }
  const side = { fixed: [] as ExpenseItem[], variable: [] as ExpenseItem[] };
  for (const b of bills) {
    if (b.monthly > 0) side[b.expense_type].push({ kind: 'bill', id: b.id, name: b.name, monthly: b.monthly });
  }
  // Variable categories count at their budget when you've set one (so this
  // matches Plan > Budget), otherwise at what you actually spend.
  const spent = (id: string | null) => Math.max(0, (avg.get(id) ?? 0) - (id ? (estimatedByCat.get(id) ?? 0) : 0));
  for (const cat of categories) {
    if (cat.kind !== 'expense' || cat.expense_type === 'fixed') continue; // fixed = your bills only
    const average = spent(cat.id);
    const budgeted = cat.monthly_budget != null;
    const monthly = budgeted ? cat.monthly_budget! : average;
    if (monthly < 1) continue;
    side.variable.push({ kind: 'category', id: cat.id, name: cat.name, monthly, average, budgeted });
  }
  const uncategorized = spent(null);
  if (uncategorized >= 1) {
    side.variable.push({ kind: 'category', id: null, name: 'Uncategorized', monthly: uncategorized, average: uncategorized, budgeted: false });
  }
  const sum = (xs: ExpenseItem[]) => xs.reduce((s, x) => s + x.monthly, 0);
  side.fixed.sort((a, b) => b.monthly - a.monthly);
  side.variable.sort((a, b) => b.monthly - a.monthly);
  return {
    fixed: { total: sum(side.fixed), items: side.fixed },
    variable: { total: sum(side.variable), items: side.variable },
  };
}

// ---------------------------------------------------------------------------
// Where to cut
// ---------------------------------------------------------------------------

interface CutRule {
  match: string;
  /** Most of the category that's realistically flexible. */
  flex: number;
  tip: string;
}

/** Most specific first. Essentials (health, giving, fixed bills) aren't cut. */
const CUT_RULES: CutRule[] = [
  { match: 'FOOD_AND_DRINK_GROCERIES', flex: 0.1, tip: 'Plan the week\u2019s meals, shop with a list, and switch to store brands.' },
  { match: 'FOOD_AND_DRINK', flex: 0.3, tip: 'Swap two takeout or restaurant meals a week for cooking at home.' },
  { match: 'GENERAL_MERCHANDISE', flex: 0.3, tip: 'Wait 48 hours before non-essential buys and unsubscribe from store emails.' },
  { match: 'ENTERTAINMENT', flex: 0.3, tip: 'Rotate streaming services: keep one or two at a time.' },
  { match: 'TRAVEL', flex: 0.3, tip: 'Book earlier, travel off-peak, and put card points toward trips.' },
  { match: 'PERSONAL_CARE', flex: 0.2, tip: 'Stretch time between appointments and compare gym memberships.' },
  { match: 'TRANSPORTATION', flex: 0.15, tip: 'Combine errands, compare gas prices, and re-quote car insurance yearly.' },
  { match: 'BANK_FEES', flex: 1, tip: 'Turn on low-balance alerts and ask your bank to waive fees.' },
  { match: 'OTHER', flex: 0.2, tip: 'Review these purchases: recategorize the ones that belong elsewhere.' },
];

function cutRule(cat: CategoryLike): CutRule | undefined {
  return CUT_RULES.find((r) => cat.provider_categories.includes(r.match));
}

export interface CutSuggestion {
  categoryId: string;
  name: string;
  average: number; // per month, trailing complete months
  target: number; // suggested monthly budget
  savings: number; // per month
  reason: string;
  tip: string;
}

/**
 * Suggests a lower monthly budget for each flexible variable category, from
 * up to 12 months of history: aim for what you spent in your lowest-spending
 * quarter of months, but never cut more than the category's flexibility (10%
 * groceries, 30% dining and shopping...). Skips savings under $10 a month.
 */
export function cutSuggestions(
  rows: FlowRowLike[],
  categories: CategoryLike[],
  now: Date,
  firstDate: string | null = null,
): CutSuggestion[] {
  const months = [...trailingMonths(now, firstDate)];
  if (months.length < 3) return [];
  rows = withoutBills(rows); // a bill isn't everyday spending to cut
  const out: CutSuggestion[] = [];
  for (const cat of categories) {
    if (cat.kind !== 'expense' || cat.expense_type === 'fixed') continue;
    const rule = cutRule(cat);
    if (!rule) continue;
    const perMonth = months.map((m) =>
      -rows
        .filter((r) => r.month === m && r.category_id === cat.id && (r.flow === 'spending' || r.flow === 'refund'))
        .reduce((s, r) => s + r.total, 0),
    );
    if (perMonth.filter((v) => v > 0).length < 3) continue; // not enough history
    const average = perMonth.reduce((s, v) => s + v, 0) / months.length;
    const k = Math.max(3, Math.round(months.length / 4));
    const lowest = [...perMonth].sort((a, b) => a - b).slice(0, k);
    const lowAvg = lowest.reduce((s, v) => s + v, 0) / k;
    const floor = average * (1 - rule.flex);
    const target = Math.ceil(Math.max(lowAvg, floor) / 10) * 10;
    const savings = average - target;
    if (savings < 10) continue;
    out.push({
      categoryId: cat.id,
      name: cat.name,
      average,
      target,
      savings,
      reason:
        lowAvg >= floor
          ? `What you spent in your ${k} lowest months`
          : `A ${Math.round(rule.flex * 100)}% trim from your average`,
      tip: rule.tip,
    });
  }
  return out.sort((a, b) => b.savings - a.savings);
}

// ---------------------------------------------------------------------------
// Even savings per paycheck
// ---------------------------------------------------------------------------

/**
 * Splits what's left after bills into the same savings and the same
 * spending money on every check.
 *
 * spendPerCheck: your variable spending (budgets or average) spread over a
 * month's paychecks. Savings is what's left of a typical check after bills
 * and that spending, unless you've set an amount yourself.
 */
export function paycheckSplit(opts: {
  typicalAfterBills: number;
  variablePerMonth: number;
  checksPerMonth: number;
  savingsOverride: number | null;
}) {
  const spendPerCheck = opts.checksPerMonth > 0 ? opts.variablePerMonth / opts.checksPerMonth : 0;
  const autoSavings = Math.max(0, Math.floor((opts.typicalAfterBills - spendPerCheck) / 10) * 10);
  const savings = opts.savingsOverride ?? autoSavings;
  return {
    spendPerCheck,
    autoSavings,
    savings,
    leftToSpend: opts.typicalAfterBills - savings,
    auto: opts.savingsOverride == null,
  };
}

// ---------------------------------------------------------------------------
// Payees you could add as bills
// ---------------------------------------------------------------------------

/** Bank-statement filler that doesn't identify who was paid (same list as the database's payee_key). */
const PAYEE_NOISE = new Set([
  'ACH', 'PPD', 'CCD', 'ID', 'DES', 'INDN', 'CO', 'DIRECT', 'DIR', 'DEP', 'DEPOSIT', 'CREDIT',
  'ELECTRONIC', 'ELEC', 'TRANSFER', 'WEB', 'ONLINE', 'PAYMENT', 'PMT', 'FROM', 'THE', 'INC',
  'LLC', 'CORP', 'CORPORATION', 'COMPANY', 'LTD', 'NA', 'TRN', 'REF', 'ORIG', 'NAME', 'ENTRY',
  'DESCR', 'SEC', 'IND', 'TRACE', 'EFF', 'DATE',
]);

/**
 * Who was paid, normalized, e.g. "ALLY" from "ALLY PAYMENT ID 123". Must
 * match public.payee_key() in the database, which links payments to bills.
 */
export function payeeKey(merchant: string | null, description: string): string {
  return (merchant?.trim() || description)
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !PAYEE_NOISE.has(w))
    .slice(0, 4)
    .join(' ');
}

export interface PayeeGroup {
  key: string;
  name: string;
  count: number;
  /** Different months it was paid in. */
  months: number;
  /** Paid in 2+ months, about once or twice a month: probably a bill. */
  recurring: boolean;
  lastAmount: number;
  lastDate: string;
  /** Usual amount: the median payment. */
  typical: number;
  /** Usual day of the month. */
  day: number;
  categoryId: string | null;
}

const titleWords = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

/** True if a bill already covers this payee (same name or detected from it). */
function coveredByBill(key: string, bills: { name: string; detection_key: string | null; match_key?: string | null }[]) {
  return bills.some((b) => {
    if (b.match_key && b.match_key === key) return true;
    if (b.detection_key && b.detection_key.replace(/#\d+$/, '') === key) return true;
    const bk = payeeKey(null, b.name);
    if (!bk) return false;
    if (bk === key) return true;
    const first = key.split(' ')[0];
    return first.length >= 4 && bk.split(' ').includes(first);
  });
}

/**
 * Groups spending by payee so you can add one as a bill, leaving out
 * payees that already have a bill. Likely bills first, biggest first.
 */
export function payeesToAdd(
  rows: { date: string; amount: number; description: string; merchant: string | null; category_id: string | null }[],
  bills: { name: string; detection_key: string | null; match_key?: string | null }[],
): PayeeGroup[] {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!(r.amount < 0)) continue; // money out only
    const key = payeeKey(r.merchant, r.description);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: PayeeGroup[] = [];
  for (const [key, items] of groups) {
    if (coveredByBill(key, bills)) continue;
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1];
    const amounts = sorted.map((r) => -r.amount).sort((a, b) => a - b);
    const typical = amounts[Math.floor(amounts.length / 2)];
    const days = new Map<number, number>();
    for (const r of sorted) days.set(+r.date.slice(8, 10), (days.get(+r.date.slice(8, 10)) ?? 0) + 1);
    const day = [...days.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    const cats = new Map<string | null, number>();
    for (const r of sorted) cats.set(r.category_id, (cats.get(r.category_id) ?? 0) + 1);
    const months = new Set(sorted.map((r) => r.date.slice(0, 7))).size;
    // Bills are paid about once or twice a month; a store you visit
    // weekly isn't one.
    out.push({
      key,
      name: last.merchant?.trim() || titleWords(key),
      count: sorted.length,
      months,
      recurring: months >= 2 && sorted.length <= months * 2.5,
      lastAmount: -last.amount,
      lastDate: last.date,
      typical: Math.round(typical * 100) / 100,
      day,
      categoryId: [...cats.entries()].sort((a, b) => b[1] - a[1])[0][0],
    });
  }
  // Recurring: biggest first. The rest: most recent first.
  return out.sort(
    (a, b) =>
      Number(b.recurring) - Number(a.recurring) ||
      (a.recurring ? b.typical - a.typical : b.lastDate.localeCompare(a.lastDate)),
  );
}

/**
 * Whether to offer the monthly budget check-in: there are suggestions you
 * haven't already set as budgets, and you haven't taken them this month.
 * Taking them hides the offer until the 1st of next month.
 */
export function budgetHelpDue(
  cuts: Pick<CutSuggestion, 'categoryId' | 'target'>[],
  budgets: Map<string, number | null>,
  doneMonth: string | null,
  now: Date,
): boolean {
  if (doneMonth && doneMonth >= monthStart(now)) return false;
  return cuts.some((x) => budgets.get(x.categoryId) !== x.target);
}

// ---------------------------------------------------------------------------
// Ways to cut: ideas that raise monthly cash flow
// ---------------------------------------------------------------------------

export type SavingsIdeaKind = 'budget' | 'subscription' | 'insurance' | 'debt' | 'fees';

export interface SavingsIdea {
  id: string;
  kind: SavingsIdeaKind;
  title: string;
  detail: string;
  /** Estimated extra cash per month if you do it. */
  monthly: number;
  /** true when the saving is an estimate (e.g. a cheaper insurance quote). */
  estimate: boolean;
  /** What to open or change: a category (budget) or a bill. */
  categoryId?: string;
  target?: number;
  billId?: string;
}

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** Bills that are usually optional monthly subscriptions. */
const SUBSCRIPTION_CODES = ['GENERAL_SERVICES', 'ENTERTAINMENT', 'PERSONAL_CARE', 'GENERAL_MERCHANDISE'];
const SUBSCRIPTION_MAX = 100; // a $3,000 mortgage isn't a subscription
const INSURANCE_CODES = ['GENERAL_SERVICES_INSURANCE'];
/** Shopping around typically saves on insurance; used as an estimate. */
const INSURANCE_SAVING = 0.1;
/** A debt costing more than this APR is worth paying down or refinancing. */
const HIGH_APR = 7;
/** The rate a refinance might get, for the estimate. */
const REFI_APR = 6;

/**
 * Ideas to raise cash flow, biggest first:
 *  - variable categories you could spend less on (from your own history),
 *  - subscriptions you could cancel,
 *  - insurance worth re-quoting (estimated 10%),
 *  - high-interest debts (interest saved by refinancing to ~6%),
 *  - bank fees you could avoid.
 */
export function savingsIdeas(opts: {
  cuts: CutSuggestion[];
  bills: { id: string; name: string; monthly: number; category_id: string | null; expense_type: 'fixed' | 'variable' }[];
  categories: CategoryLike[];
  debts: { billId: string; name: string; balance: number | null; apr: number | null }[];
  /** Average monthly spending per category (bill payments left out). */
  categoryAverages: Map<string | null, number>;
}): SavingsIdea[] {
  const ideas: SavingsIdea[] = [];
  const catOf = (id: string | null) => (id ? opts.categories.find((c) => c.id === id) : undefined);
  const has = (id: string | null, codes: string[]) =>
    !!catOf(id)?.provider_categories.some((p) => codes.some((code) => p === code || p.startsWith(code + '_')));

  for (const x of opts.cuts) {
    ideas.push({
      id: `budget:${x.categoryId}`,
      kind: 'budget',
      title: `Spend ${Math.round((x.savings / x.average) * 100)}% less on ${x.name}`,
      detail: `${x.tip} Budget ${usd(x.target)} instead of your usual ${usd(x.average)}.`,
      monthly: x.savings,
      estimate: false,
      categoryId: x.categoryId,
      target: x.target,
    });
  }

  const debtIds = new Set(opts.debts.map((d) => d.billId));
  for (const b of opts.bills) {
    if (debtIds.has(b.id) || b.monthly <= 0) continue;
    if (has(b.category_id, INSURANCE_CODES)) {
      ideas.push({
        id: `insurance:${b.id}`,
        kind: 'insurance',
        title: `Shop around for ${b.name}`,
        detail: 'Get 2–3 quotes at renewal, raise deductibles if you have savings, and bundle home and auto.',
        monthly: b.monthly * INSURANCE_SAVING,
        estimate: true,
        billId: b.id,
      });
    } else if (b.monthly <= SUBSCRIPTION_MAX && has(b.category_id, SUBSCRIPTION_CODES)) {
      ideas.push({
        id: `subscription:${b.id}`,
        kind: 'subscription',
        title: `Cancel or pause ${b.name}`,
        detail: 'Rotate services month to month, or switch to a cheaper plan.',
        monthly: b.monthly,
        estimate: false,
        billId: b.id,
      });
    }
  }

  for (const d of opts.debts) {
    if (d.balance == null || d.apr == null || d.apr <= HIGH_APR || d.balance <= 0) continue;
    const interest = (d.balance * d.apr) / 1200;
    const saved = (d.balance * (d.apr - REFI_APR)) / 1200;
    ideas.push({
      id: `debt:${d.billId}`,
      kind: 'debt',
      title: `Refinance or pay down ${d.name} (${d.apr}%)`,
      detail: `It costs about ${usd(interest)} a month in interest. At ~${REFI_APR}% that would drop by the amount shown; extra payments shrink it too.`,
      monthly: saved,
      estimate: true,
      billId: d.billId,
    });
  }

  for (const c of opts.categories) {
    if (!c.provider_categories.includes('BANK_FEES')) continue;
    const fees = opts.categoryAverages.get(c.id) ?? 0;
    if (fees >= 1) {
      ideas.push({
        id: `fees:${c.id}`,
        kind: 'fees',
        title: 'Stop paying bank fees',
        detail: 'Turn on low-balance alerts, use in-network ATMs, and ask your bank to waive fees.',
        monthly: fees,
        estimate: false,
        categoryId: c.id,
      });
    }
  }

  return ideas.filter((i) => i.monthly >= 1).sort((a, b) => b.monthly - a.monthly);
}
