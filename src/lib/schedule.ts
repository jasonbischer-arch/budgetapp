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
    for (const { year, month } of monthsBetween(from, to)) {
      for (const day of days) {
        if (!day) continue;
        const d = dayOfMonth(year, month, day);
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

/** The part of a bill paid from one check (the whole bill unless split). */
export interface PlannedBill extends Occurrence {
  fullAmount: number;
  split: boolean;
}

export interface PlannedCheck extends Occurrence {
  bills: PlannedBill[];
  billsTotal: number;
  leftover: number;
}

export interface PaycheckPlan {
  checks: PlannedCheck[];
  /** Bills due before any upcoming paycheck can cover them: pay from cash. */
  fromCash: Occurrence[];
  /** The average left per check. */
  target: number;
}

/** How early a bill may be paid: from a paycheck at most this many days before it's due. */
const PAY_WINDOW_DAYS = 31;
/** Bills this big may be split across checks (set aside part from each). */
const SPLIT_MIN = 300;
/** Leftovers within this many dollars count as even. */
const TOLERANCE = 10;
/** Split pieces smaller than this are folded back into the rest of the bill. */
const MIN_PIECE = 50;

/**
 * Assigns each bill to paychecks that arrive on or before its due date (and
 * within a month of it), so every check keeps about the same amount.
 *
 * 1. Largest bill first, each onto the eligible check with the most left.
 * 2. Move whole bills between checks while that evens things out.
 * 3. Big bills (rent, car...) may then be split: part set aside from an
 *    earlier check, the rest from a later one. Small bills stay whole.
 */
export function buildPaycheckPlan(
  incomes: PaySchedule[],
  bills: BillSchedule[],
  from: ISODate,
  to: ISODate,
): PaycheckPlan {
  const checks: PlannedCheck[] = incomes
    .flatMap((s) => paydays(s, from, to))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
    .map((c) => ({ ...c, bills: [], billsTotal: 0, leftover: c.amount }));

  // Bills slightly past the horizon can still be paid by its last checks.
  const billOccurrences = bills
    .flatMap((b) => dueDates(b, from, addDays(to, PAY_WINDOW_DAYS)))
    .filter((b) => b.amount > 0);

  const fromCash: Occurrence[] = [];
  const allocs: { bill: Occurrence; options: PlannedCheck[]; parts: Map<PlannedCheck, number> }[] = [];
  for (const bill of billOccurrences) {
    const options = checks.filter(
      (c) => c.date <= bill.date && daysBetween(c.date, bill.date) < PAY_WINDOW_DAYS,
    );
    if (options.length) allocs.push({ bill, options, parts: new Map() });
    else if (bill.date <= to) fromCash.push(bill);
    // Otherwise it's due after this window and belongs to the next plan.
  }

  const move = (
    a: (typeof allocs)[number],
    fromCheck: PlannedCheck | null,
    toCheck: PlannedCheck,
    amount: number,
  ) => {
    if (fromCheck) {
      const left = (a.parts.get(fromCheck) ?? 0) - amount;
      if (left > 0.004) a.parts.set(fromCheck, left);
      else a.parts.delete(fromCheck);
      fromCheck.leftover += amount;
    }
    a.parts.set(toCheck, (a.parts.get(toCheck) ?? 0) + amount);
    toCheck.leftover -= amount;
  };

  // 1. Largest bills first, each onto the eligible check with the most left.
  allocs.sort((a, b) => b.bill.amount - a.bill.amount);
  for (const a of allocs) {
    const best = a.options.reduce((x, y) =>
      y.leftover > x.leftover || (y.leftover === x.leftover && y.date > x.date) ? y : x,
    );
    move(a, null, best, a.bill.amount);
  }

  // 2. Move whole bills while that shrinks the gap between two checks.
  for (let pass = 0; pass < 50; pass++) {
    let improved = false;
    for (const a of allocs) {
      const [current] = [...a.parts.keys()];
      for (const alt of a.options) {
        if (alt === current) continue;
        const before = Math.abs(current.leftover - alt.leftover);
        const after = Math.abs(current.leftover + a.bill.amount - (alt.leftover - a.bill.amount));
        if (after < before - 0.005) {
          move(a, current, alt, a.bill.amount);
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }

  // 3. Split big bills: shift whole dollars from a tighter check to a
  //    roomier eligible one until leftovers are within the tolerance.
  for (let pass = 0; pass < 500; pass++) {
    let improved = false;
    for (const a of allocs) {
      if (a.bill.amount < SPLIT_MIN) continue;
      for (const [payer, amount] of [...a.parts]) {
        for (const alt of a.options) {
          const gap = alt.leftover - payer.leftover;
          if (alt === payer || gap <= TOLERANCE) continue;
          const shift = Math.min(amount, Math.floor(gap / 2));
          if (shift < 1) continue;
          move(a, payer, alt, shift);
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }

  // 4. Fold tiny pieces (under $50) back into the bill's other part on the
  //    roomiest check, so nobody has to set aside $8 for the car.
  for (const a of allocs) {
    for (const [check, amount] of [...a.parts]) {
      if (a.parts.size < 2 || amount >= MIN_PIECE) continue;
      const others = [...a.parts.keys()].filter((c) => c !== check);
      const roomiest = others.reduce((x, y) => (y.leftover > x.leftover ? y : x));
      move(a, check, roomiest, amount);
    }
  }

  for (const a of allocs) {
    for (const [check, amount] of a.parts) {
      check.bills.push({
        ...a.bill,
        amount: Math.round(amount * 100) / 100,
        fullAmount: a.bill.amount,
        split: a.parts.size > 1,
      });
    }
  }
  for (const c of checks) {
    c.bills.sort((x, y) => x.date.localeCompare(y.date));
    c.billsTotal = c.bills.reduce((s, b) => s + b.amount, 0);
    c.leftover = Math.round((c.amount - c.billsTotal) * 100) / 100;
  }
  const target = checks.length ? checks.reduce((s, c) => s + c.leftover, 0) / checks.length : 0;
  return { checks, fromCash: fromCash.sort((a, b) => a.date.localeCompare(b.date)), target };
}

// ---------------------------------------------------------------------------
// Paycheck detection
// ---------------------------------------------------------------------------

export interface IncomeSuggestion {
  name: string;
  amount: number;
  frequency: PaySchedule['frequency'];
  anchor_date: ISODate | null;
  day1: number | null;
  day2: number | null;
  occurrences: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function normalizeName(s: string) {
  return s
    .toUpperCase()
    .replace(/[0-9#*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Finds regular deposits (paychecks) in money-in transactions: same payer,
 * at least 3 times, $100+, at a weekly, every-2-weeks, twice-monthly or
 * monthly rhythm.
 */
export function detectIncome(
  txns: { date: ISODate; amount: number; description: string; merchant: string | null }[],
): IncomeSuggestion[] {
  const groups = new Map<string, { date: ISODate; amount: number; label: string }[]>();
  for (const t of txns) {
    if (t.amount < 100) continue;
    const label = t.merchant || t.description;
    const key = normalizeName(label);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), { date: t.date, amount: t.amount, label }]);
  }

  const out: IncomeSuggestion[] = [];
  for (const [, items] of groups) {
    if (items.length < 3) continue;
    items.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = items.slice(1).map((it, i) => daysBetween(items[i].date, it.date));
    const gap = median(gaps);
    const last = items.at(-1)!;
    const amount = Math.round(median(items.slice(-3).map((i) => i.amount)) * 100) / 100;
    const base = { name: titleCase(normalizeName(last.label)), amount, occurrences: items.length };

    if (gap >= 6 && gap <= 8) {
      out.push({ ...base, frequency: 'weekly', anchor_date: last.date, day1: null, day2: null });
    } else if (gap >= 13 && gap <= 15) {
      // Twice-monthly pay also has ~15-day gaps; tell them apart by whether
      // the day of the month repeats.
      const days = items.map((i) => Number(i.date.slice(8)));
      const distinct = [...new Set(days)];
      if (distinct.length <= 3 && items.length >= 4) {
        const sorted = distinct.sort((a, b) => a - b);
        out.push({ ...base, frequency: 'semimonthly', anchor_date: null, day1: sorted[0], day2: sorted.at(-1)! });
      } else {
        out.push({ ...base, frequency: 'biweekly', anchor_date: last.date, day1: null, day2: null });
      }
    } else if (gap >= 27 && gap <= 33) {
      out.push({ ...base, frequency: 'monthly', anchor_date: null, day1: Number(last.date.slice(8)), day2: null });
    }
  }
  return out.sort((a, b) => b.amount - a.amount);
}
