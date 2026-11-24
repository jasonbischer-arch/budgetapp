// Pay schedules, bill due dates, and the "even leftover per paycheck" plan.
// Pure functions (no app imports) so they're easy to test.

export type ISODate = string; // YYYY-MM-DD

// ---------------------------------------------------------------------------
// Dates (local calendar dates, no time zones)
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon avoids DST edge cases
}

export function addDays(s: ISODate, days: number): ISODate {
  const d = parseISO(s);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

export function today(): ISODate {
  return toISO(new Date());
}

/** Day `day` of a month, clamped to the month's length (31 -> 30 in April). */
export function dayOfMonth(year: number, monthIndex: number, day: number): ISODate {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return toISO(new Date(year, monthIndex, Math.min(day, last), 12));
}

export function endOfMonth(s: ISODate): ISODate {
  const d = parseISO(s);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
}

export function startOfMonth(s: ISODate): ISODate {
  return s.slice(0, 8) + '01';
}

/** Months (year, index) overlapping [from, to]. */
function monthsBetween(from: ISODate, to: ISODate) {
  const out: { year: number; month: number }[] = [];
  const a = parseISO(from);
  const b = parseISO(to);
  for (let y = a.getFullYear(), m = a.getMonth(); y < b.getFullYear() || (y === b.getFullYear() && m <= b.getMonth()); ) {
    out.push({ year: y, month: m });
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

export interface PaySchedule {
  id: string;
  name: string;
  amount: number;
  frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  anchor_date: ISODate | null;
  day1: number | null;
  day2: number | null;
  /** Twice-monthly/monthly payday on a weekend: Friday before, Monday after. */
  weekend_shift?: 'none' | 'before' | 'after';
}

export interface BillSchedule {
  id: string;
  name: string;
  amount: number; // effective amount (manual, or the linked account's minimum)
  frequency: 'monthly' | 'quarterly' | 'yearly';
  due_day: number;
  due_month: number | null; // 1-12
}

export interface Occurrence {
  id: string; // source id + date, unique
  refId: string;
  name: string;
  date: ISODate;
  amount: number;
  /** A payday whose amount you entered (commission), or extra income. */
  edited?: boolean;
}

/** Paydays for a schedule within [from, to]. */
export function paydays(src: PaySchedule, from: ISODate, to: ISODate): Occurrence[] {
  const dates: ISODate[] = [];
  if ((src.frequency === 'weekly' || src.frequency === 'biweekly') && src.anchor_date) {
    const step = src.frequency === 'weekly' ? 7 : 14;
    const k = Math.ceil(daysBetween(src.anchor_date, from) / step);
    for (let d = addDays(src.anchor_date, k * step); d <= to; d = addDays(d, step)) dates.push(d);
  } else {
    const days = src.frequency === 'semimonthly' ? [src.day1, src.day2] : [src.day1];
    // Look a few days past each end: a weekend shift can move a payday in.
    for (const { year, month } of monthsBetween(addDays(from, -3), addDays(to, 3))) {
      for (const day of days) {
        if (!day) continue;
        const d = shiftWeekend(dayOfMonth(year, month, day), src.weekend_shift ?? 'none');
        if (d >= from && d <= to) dates.push(d);
      }
    }
  }
  return dates.sort().map((date) => ({
    id: `${src.id}:${date}`,
    refId: src.id,
    name: src.name,
    date,
    amount: src.amount,
  }));
}

/** Moves a Saturday/Sunday date to the Friday before or the Monday after. */
export function shiftWeekend(date: ISODate, rule: 'none' | 'before' | 'after'): ISODate {
  const dow = parseISO(date).getDay();
  if (rule === 'none' || (dow !== 0 && dow !== 6)) return date;
  if (rule === 'before') return addDays(date, dow === 6 ? -1 : -2);
  return addDays(date, dow === 6 ? 2 : 1);
}

/** Due dates for a bill within [from, to]. */
export function dueDates(bill: BillSchedule, from: ISODate, to: ISODate): Occurrence[] {
  const out: Occurrence[] = [];
  for (const { year, month } of monthsBetween(from, to)) {
    const m = month + 1;
    if (bill.frequency === 'quarterly' && ((m - (bill.due_month ?? 1)) % 3 + 3) % 3 !== 0) continue;
    if (bill.frequency === 'yearly' && m !== bill.due_month) continue;
    const date = dayOfMonth(year, month, bill.due_day);
    if (date >= from && date <= to) {
      out.push({ id: `${bill.id}:${date}`, refId: bill.id, name: bill.name, date, amount: bill.amount });
    }
  }
  return out;
}

/** Average monthly amount of a pay schedule or bill. */
export function monthlyAmount(
  frequency: PaySchedule['frequency'] | BillSchedule['frequency'],
  amount: number,
): number {
  switch (frequency) {
    case 'weekly':
      return (amount * 52) / 12;
    case 'biweekly':
      return (amount * 26) / 12;
    case 'semimonthly':
      return amount * 2;
    case 'quarterly':
      return amount / 3;
    case 'yearly':
      return amount / 12;
    default:
      return amount;
  }
}

// ---------------------------------------------------------------------------
// Paycheck plan
// ---------------------------------------------------------------------------

/** A bill paid from one check: the whole bill, unless it's bigger than the check (`split`). */
export interface PlannedBill extends Occurrence {
  fullAmount: number;
  /** Paid from more than one check. */
  split: boolean;
  /** Placed by your own plan (a rule you set), not automatically. */
  custom?: boolean;
}

/**
 * Your own plan for a bill: which paycheck pays it. A bill can be split
 * across paychecks: rules with an amount pay that much, a rule without one
 * pays the rest.
 */
export interface PlanRule {
  billId: string;
  /** The income source (paycheck schedule) to pay from. */
  sourceId: string;
  /** Dollars from this paycheck; null = whatever's left of the bill. */
  amount: number | null;
}

/**
 * What you said a payday will really be (e.g. this month's commission), or
 * income that isn't on a schedule (sourceId null).
 */
export interface IncomeEdit {
  id: string;
  sourceId: string | null;
  date: ISODate;
  name: string;
  amount: number;
}

/**
 * Paydays with your edits applied: an edited check takes your amount, and
 * extra income is added on its date. An edit whose payday is no longer on
 * the schedule still counts, as extra income.
 */
export function applyIncomeEdits(checks: Occurrence[], edits: IncomeEdit[], from: ISODate, to: ISODate): Occurrence[] {
  const used = new Set<string>();
  const out = checks.map((c) => {
    const e = edits.find((x) => x.sourceId === c.refId && x.date === c.date);
    if (!e) return c;
    used.add(e.id);
    return { ...c, amount: e.amount, edited: true };
  });
  for (const e of edits) {
    if (used.has(e.id) || e.date < from || e.date > to) continue;
    out.push({
      id: `extra:${e.id}`,
      refId: e.sourceId ?? `extra:${e.id}`,
      name: e.name,
      date: e.date,
      amount: e.amount,
      edited: true,
    });
  }
  return out;
}

export interface PlannedCheck extends Occurrence {
  bills: PlannedBill[];
  billsTotal: number;
  leftover: number;
}

export interface PaycheckPlan {
  checks: PlannedCheck[];
  /** Small deposits (e.g. a $116 side payment) not used to pay bills. */
  smallIncome: Occurrence[];
  /** Bills due before any upcoming paycheck can cover them: pay from cash. */
  fromCash: Occurrence[];
  /** The average left per check. */
  target: number;
}

/** How early a bill may be paid: from a paycheck at most this many days before it's due. */
const PAY_WINDOW_DAYS = 31;

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Divides your fixed bills across your paychecks so every check is left
 * with the same amount. Bills are split between checks when that's what it
 * takes. A bill is only ever paid from checks that arrive on or before its
 * due date (and within a month of it).
 *
 * 1. Bills you placed yourself (`rules`) go on the paycheck you chose.
 * 2. The rest: largest first onto the eligible check with the most left,
 *    then whole bills move or swap between checks while that evens things
 *    out (so bills stay whole when they can).
 * 3. Then split: shift part of a bill from a check with less left to an
 *    eligible check with more, until every check is even to the cent, or
 *    no eligible check can take more.
 */
export function buildPaycheckPlan(
  incomes: PaySchedule[],
  bills: BillSchedule[],
  from: ISODate,
  to: ISODate,
  edits: IncomeEdit[] = [],
  rules: PlanRule[] = [],
): PaycheckPlan {
  const all = applyIncomeEdits(incomes.flatMap((s) => paydays(s, from, to)), edits, from, to).sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
  // Real paychecks only: a deposit under a fifth of your typical check (a
  // small side payment) isn't one of the checks bills are divided across.
  const sorted = all.map((c) => c.amount).sort((a, b) => a - b);
  const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const isSmall = (c: Occurrence) => c.amount < 0.2 * typical;
  const smallIncome = all.filter(isSmall);
  const checks: PlannedCheck[] = all
    .filter((c) => !isSmall(c))
    .map((c) => ({ ...c, bills: [], billsTotal: 0, leftover: c.amount }));

  // Bills due after the plan ends belong to the next plan, unless they're
  // due before the next paycheck after it (then only these checks can pay).
  const nextPayday = incomes
    .flatMap((s) => paydays(s, addDays(to, 1), addDays(to, PAY_WINDOW_DAYS)))
    .filter((c) => !(c.amount < 0.2 * typical))
    .map((c) => c.date)
    .sort()[0];
  const billOccurrences = bills
    .flatMap((b) => dueDates(b, from, addDays(to, PAY_WINDOW_DAYS)))
    .filter((b) => b.amount > 0)
    .filter((b) => b.date <= to || (nextPayday ? b.date < nextPayday : true));

  type Alloc = { bill: Occurrence; options: PlannedCheck[]; parts: Map<PlannedCheck, number>; custom: boolean };
  const fromCash: Occurrence[] = [];
  const auto: Alloc[] = [];
  const placed: Alloc[] = [];
  const give = (a: Alloc, check: PlannedCheck, amount: number) => {
    a.parts.set(check, cents((a.parts.get(check) ?? 0) + amount));
    if ((a.parts.get(check) ?? 0) <= 0.004) a.parts.delete(check);
    check.leftover = cents(check.leftover - amount);
  };

  for (const bill of billOccurrences) {
    const options = checks.filter((c) => c.date <= bill.date && daysBetween(c.date, bill.date) < PAY_WINDOW_DAYS);
    if (!options.length) {
      if (bill.date <= to) fromCash.push(bill);
      continue; // or it's due after this window and belongs to the next plan
    }
    // 1. Your own plan: the latest check from the paycheck you chose.
    const mine = rules.filter((r) => r.billId === bill.refId);
    let rest = bill.amount;
    if (mine.length) {
      const a: Alloc = { bill, options, parts: new Map(), custom: true };
      const ordered = [...mine.filter((r) => r.amount != null), ...mine.filter((r) => r.amount == null)];
      for (const r of ordered) {
        const check = [...options].reverse().find((c) => c.refId === r.sourceId);
        const amount = cents(Math.min(rest, r.amount ?? rest));
        if (!check || amount <= 0) continue;
        give(a, check, amount);
        rest = cents(rest - amount);
      }
      if (a.parts.size) placed.push(a);
    }
    // Anything your plan doesn't cover (or no rule) is planned automatically.
    if (rest > 0.004) auto.push({ bill: { ...bill, amount: rest }, options, parts: new Map(), custom: false });
  }

  // 2. Whole bills: largest first onto the eligible check with the most left.
  auto.sort((a, b) => b.bill.amount - a.bill.amount);
  for (const a of auto) {
    const best = a.options.reduce((x, y) => (y.leftover > x.leftover || (y.leftover === x.leftover && y.date > x.date) ? y : x));
    give(a, best, a.bill.amount);
  }
  //    Move or swap whole bills while that evens things out. Moving amount m
  //    from check i to j changes the sum of squared leftovers by
  //    2m(Li - Lj + m); swapping bills a (on i) and b (on j) by
  //    2d(Li - Lj + d) with d = a - b. Negative = more even.
  const on = (a: Alloc) => [...a.parts.keys()][0];
  for (let pass = 0; pass < 200; pass++) {
    let improved = false;
    for (const a of auto) {
      const i = on(a);
      const m = a.bill.amount;
      const move = a.options.find((j) => j !== i && 2 * m * (i.leftover - j.leftover + m) < -0.005);
      if (move) {
        give(a, i, -m);
        give(a, move, m);
        improved = true;
        continue;
      }
      for (const b of auto) {
        const j = on(b);
        if (j === i || !a.options.includes(j) || !b.options.includes(i)) continue;
        const d = m - b.bill.amount;
        if (2 * d * (i.leftover - j.leftover + d) < -0.005) {
          give(a, i, -m);
          give(a, j, m);
          give(b, j, -b.bill.amount);
          give(b, i, b.bill.amount);
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }

  // 3. Split to make every check even: move part of a bill from a check
  //    with less left to an eligible check with more.
  for (let pass = 0; pass < 5000; pass++) {
    let best: { a: Alloc; from: PlannedCheck; to: PlannedCheck; amount: number } | null = null;
    for (const a of auto) {
      for (const [fromCheck, part] of a.parts) {
        for (const toCheck of a.options) {
          const gap = toCheck.leftover - fromCheck.leftover;
          if (toCheck === fromCheck || gap < 0.02) continue;
          const amount = Math.min(part, cents(gap / 2));
          if (amount >= 0.01 && (!best || gap > best.to.leftover - best.from.leftover)) {
            best = { a, from: fromCheck, to: toCheck, amount };
          }
        }
      }
    }
    if (!best) break;
    give(best.a, best.from, -best.amount);
    give(best.a, best.to, best.amount);
  }

  for (const a of [...placed, ...auto]) {
    for (const [check, amount] of a.parts) {
      check.bills.push({
        ...a.bill,
        amount,
        fullAmount: a.bill.amount, // set to the whole bill below
        split: false,
        custom: a.custom,
      });
    }
  }
  // A bill is split if, in total, it's paid from more than one check.
  const fullById = new Map(billOccurrences.map((b) => [b.id, b.amount]));
  const checksById = new Map<string, number>();
  for (const c of checks) for (const b of c.bills) checksById.set(b.id, (checksById.get(b.id) ?? 0) + 1);
  for (const c of checks) {
    for (const b of c.bills) {
      b.fullAmount = fullById.get(b.id) ?? b.fullAmount;
      b.split = (checksById.get(b.id) ?? 0) > 1;
    }
    // Merge two pieces of the same bill on one check (your rule + automatic).
    const merged = new Map<string, PlannedBill>();
    for (const b of c.bills) {
      const m = merged.get(b.id);
      if (m) m.amount = cents(m.amount + b.amount);
      else merged.set(b.id, { ...b });
    }
    c.bills = [...merged.values()].sort((x, y) => x.date.localeCompare(y.date));
    c.billsTotal = cents(c.bills.reduce((s2, b) => s2 + b.amount, 0));
    c.leftover = cents(c.amount - c.billsTotal);
  }
  const target = checks.length ? checks.reduce((s2, c) => s2 + c.leftover, 0) / checks.length : 0;
  return { checks, smallIncome, fromCash: fromCash.sort((a, b) => a.date.localeCompare(b.date)), target };
}
