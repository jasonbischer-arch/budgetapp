// Turns monthly money-flow totals into the numbers the app shows: trailing
// averages, period totals, spending by category, and where to cut.
// Pure functions so they're easy to test.

export interface FlowRowLike {
  month: string; // YYYY-MM-01
  flow: 'income' | 'spending' | 'refund' | 'saved';
  category_id: string | null;
  total: number; // signed: spending/saved negative, income/refund positive
}

export interface CategoryLike {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'transfer' | 'savings';
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
export function trailingAverages(rows: FlowRowLike[], now: Date, firstDate: string | null) {
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
// Where to cut
// ---------------------------------------------------------------------------

/**
 * How much of a category's spending is realistically flexible. Essentials
 * (rent, utilities, insurance, loans, taxes, health) aren't suggested.
 */
function flexibility(cat: CategoryLike): number {
  const p = cat.provider_categories;
  if (p.includes('FOOD_AND_DRINK_GROCERIES')) return 0.1;
  if (p.includes('TRANSPORTATION')) return 0.15;
  if (
    ['FOOD_AND_DRINK', 'GENERAL_MERCHANDISE', 'ENTERTAINMENT', 'TRAVEL', 'PERSONAL_CARE'].some((x) =>
      p.includes(x),
    )
  ) {
    return 0.3;
  }
  if (p.includes('GENERAL_SERVICES') || p.includes('OTHER')) return 0.2;
  return 0;
}

export interface CutSuggestion {
  categoryId: string;
  name: string;
  average: number; // per month, last 6 complete months
  target: number; // suggested monthly budget
  savings: number; // per month
  reason: string;
}

/**
 * Suggests a monthly budget for flexible categories, based on the last six
 * complete months: aim for what you spent in your three lowest months, but
 * never cut more than the category's flexibility (10% groceries, 30% dining
 * and shopping...). Skips savings under $10 a month.
 */
export function cutSuggestions(
  rows: FlowRowLike[],
  categories: CategoryLike[],
  now: Date,
): CutSuggestion[] {
  const months = Array.from({ length: 6 }, (_, i) => monthStart(now, -(i + 1)));
  const out: CutSuggestion[] = [];
  for (const cat of categories) {
    if (cat.kind !== 'expense') continue;
    const flex = flexibility(cat);
    if (!flex) continue;
    const perMonth = months.map((m) =>
      -rows
        .filter((r) => r.month === m && r.category_id === cat.id && (r.flow === 'spending' || r.flow === 'refund'))
        .reduce((s, r) => s + r.total, 0),
    );
    const active = perMonth.filter((v) => v > 0).length;
    if (active < 3) continue; // not enough history to judge
    const average = perMonth.reduce((s, v) => s + v, 0) / months.length;
    const lowest3 = [...perMonth].sort((a, b) => a - b).slice(0, 3);
    const lowAvg = lowest3.reduce((s, v) => s + v, 0) / 3;
    const floor = average * (1 - flex);
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
          ? 'Matches what you spent in your 3 lowest months'
          : `A ${Math.round(flex * 100)}% trim from your average`,
    });
  }
  return out.sort((a, b) => b.savings - a.savings);
}
