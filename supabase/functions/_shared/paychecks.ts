// Paycheck detection: finds regular deposits in bank history and works out
// each paycheck's schedule, average amount and the days it lands on.
//
// Pure TypeScript (no Deno or app imports): runs in the Edge Functions and
// in the test suite (tests/paychecks.test.ts).

export type ISODate = string; // YYYY-MM-DD

export interface Deposit {
  date: ISODate;
  amount: number; // positive = money in
  description: string;
  merchant: string | null;
  category_detailed?: string | null; // Plaid, e.g. INCOME_WAGES
}

export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
export type WeekendShift = 'none' | 'before' | 'after';

export interface DetectedPaycheck {
  /** Stable id for this payer (+ amount band if one payer pays two people). */
  key: string;
  name: string;
  frequency: PayFrequency;
  /** A known payday (weekly / every 2 weeks). */
  anchor_date: ISODate | null;
  /** Payday(s) of the month (monthly / twice a month). 31 = last day. */
  day1: number | null;
  day2: number | null;
  /** When the payday falls on a weekend: paid the Friday before, the Monday after. */
  weekend_shift: WeekendShift;
  /** Typical take-home: mean of recent checks, ignoring bonuses/short checks. */
  average: number;
  /**
   * What to budget with: the lowest of the recent typical checks. For pay
   * that varies (base pay + commission) this is the dependable part.
   */
  low: number;
  last_amount: number;
  last_paid: ISODate;
  occurrences: number;
  /** Still arriving (seen within about 1.5 pay periods). */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Date helpers (UTC, so results don't depend on the server's time zone)
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const toTime = (d: ISODate) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromTime = (t: number): ISODate => new Date(t).toISOString().slice(0, 10);
const daysBetween = (a: ISODate, b: ISODate) => Math.round((toTime(b) - toTime(a)) / DAY);
const weekday = (d: ISODate) => new Date(toTime(d)).getUTCDay(); // 0 Sun .. 6 Sat
const dayOfMonth = (d: ISODate) => +d.slice(8, 10);
const daysInMonth = (d: ISODate) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate();
const isWeekend = (d: ISODate) => weekday(d) === 0 || weekday(d) === 6;

/** The nominal payday `day` in the month of `d` (31 = last day of month). */
function nominalDate(d: ISODate, day: number): ISODate {
  return d.slice(0, 8) + String(Math.min(day, daysInMonth(d))).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Grouping deposits by payer
// ---------------------------------------------------------------------------

/** Bank-statement filler that doesn't identify the payer. */
const NOISE = new Set([
  'ACH', 'PPD', 'CCD', 'ID', 'DES', 'INDN', 'CO', 'DIRECT', 'DIR', 'DEP', 'DEPOSIT', 'CREDIT',
  'ELECTRONIC', 'ELEC', 'TRANSFER', 'WEB', 'ONLINE', 'PAYMENT', 'PMT', 'FROM', 'THE', 'INC',
  'LLC', 'CORP', 'CORPORATION', 'COMPANY', 'LTD', 'NA', 'TRN', 'REF', 'ORIG', 'NAME', 'ENTRY',
  'DESCR', 'SEC', 'IND', 'TRACE', 'EFF', 'DATE',
]);

export function payerKey(d: Pick<Deposit, 'description' | 'merchant'>): string {
  const source = d.merchant?.trim() || d.description;
  return source
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !NOISE.has(w))
    .slice(0, 4)
    .join(' ');
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Splits one payer's deposits into amount bands, so two people paid by the
 * same company (or payroll provider) become two paychecks.
 */
function amountBands(items: Deposit[]): Deposit[][] {
  const bands: Deposit[][] = [];
  for (const d of [...items].sort((a, b) => b.amount - a.amount)) {
    const band = bands.find((b) => Math.abs(d.amount - median(b.map((x) => x.amount))) <= 0.3 * median(b.map((x) => x.amount)));
    if (band) band.push(d);
    else bands.push([d]);
  }
  return bands;
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/** Groups days of the month into two paydays (e.g. 7th & 22nd, 15th & last). */
function twoPaydays(days: number[]): [number[], number[]] {
  let a = Math.min(...days);
  let b = Math.max(...days);
  let lo: number[] = [];
  let hi: number[] = [];
  for (let i = 0; i < 10; i++) {
    lo = days.filter((d) => Math.abs(d - a) <= Math.abs(d - b));
    hi = days.filter((d) => Math.abs(d - a) > Math.abs(d - b));
    if (!hi.length) break;
    a = lo.reduce((s, d) => s + d, 0) / lo.length;
    b = hi.reduce((s, d) => s + d, 0) / hi.length;
  }
  return [lo, hi];
}

/** The usual payday in a cluster: the most common day; "last day" if 28+. */
function nominalDay(days: number[]): number {
  if (Math.min(...days) >= 28) return 31;
  const counts = new Map<number, number>();
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
  // Most common; ties go to the later day (weekend shifts only move earlier
  // under the usual "Friday before" rule).
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0];
}

/** Infers the weekend rule from months when a payday fell on a weekend. */
function weekendShift(dates: ISODate[], paydays: number[]): WeekendShift {
  let before = 0;
  let after = 0;
  for (const date of dates) {
    // The nominal payday this deposit belongs to: the closest one.
    const day = paydays.reduce((best, p) =>
      Math.abs(dayOfMonth(nominalDate(date, p)) - dayOfMonth(date)) <
      Math.abs(dayOfMonth(nominalDate(date, best)) - dayOfMonth(date))
        ? p
        : best,
    );
    const nominal = nominalDate(date, day);
    if (nominal === date || !isWeekend(nominal)) continue;
    const diff = daysBetween(nominal, date);
    if (diff < 0 && diff >= -3) before++;
    else if (diff > 0 && diff <= 3) after++;
  }
  if (after > before) return 'after';
  return 'before'; // the common payroll rule, and the default with no evidence
}

const CYCLE_DAYS: Record<PayFrequency, number> = { weekly: 7, biweekly: 14, semimonthly: 15.2, monthly: 30.4 };

/**
 * Finds paychecks: deposits from the same payer, at least 3 times, $100 or
 * more, arriving weekly, every 2 weeks, twice a month or monthly.
 */
export function detectPaychecks(deposits: Deposit[], today: ISODate): DetectedPaycheck[] {
  const byPayer = new Map<string, Deposit[]>();
  for (const d of deposits) {
    if (!(d.amount >= 100)) continue;
    const key = payerKey(d);
    if (!key) continue;
    byPayer.set(key, [...(byPayer.get(key) ?? []), d]);
  }

  const out: DetectedPaycheck[] = [];
  for (const [payer, items] of byPayer) {
    // One payer, one day = one paycheck (e.g. base pay and commission sent
    // as two deposits on the same Friday). Read the schedule from those
    // combined paydays first; only split by amount if that finds nothing
    // (e.g. two people paid by the same payroll company on different days).
    const byDay = new Map<ISODate, Deposit>();
    for (const d of items) {
      const prev = byDay.get(d.date);
      byDay.set(d.date, prev ? { ...prev, amount: prev.amount + d.amount } : { ...d });
    }
    const whole = byDay.size >= 3 ? classify([...byDay.values()], today) : null;
    if (whole) {
      out.push({ key: payer, name: titleCase(payer), ...whole });
      continue;
    }
    const bands = amountBands(items).filter((b) => b.length >= 3);
    bands.forEach((band, i) => {
      const found = classify(band, today);
      if (!found) return;
      const key = bands.length > 1 ? `${payer}#${i + 1}` : payer;
      const name = bands.length > 1 ? `${titleCase(payer)} (~$${Math.round(found.average).toLocaleString('en-US')})` : titleCase(payer);
      out.push({ key, name, ...found });
    });
  }
  return out.sort((a, b) => b.average - a.average);
}

function classify(band: Deposit[], today: ISODate): Omit<DetectedPaycheck, 'key' | 'name'> | null {
  // One deposit per day (a split direct deposit counts once).
  const byDate = new Map<ISODate, number>();
  for (const d of band) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.amount);
  const dates = [...byDate.keys()].sort();
  if (dates.length < 3) return null;
  const amounts = dates.map((d) => byDate.get(d)!);

  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
  const gap = median(gaps);
  const last = dates.at(-1)!;

  let frequency: PayFrequency;
  let anchor_date: ISODate | null = null;
  let day1: number | null = null;
  let day2: number | null = null;
  let shift: WeekendShift = 'none';

  if (gap >= 5 && gap <= 9) {
    frequency = 'weekly';
    anchor_date = last;
  } else if (gap >= 12 && gap <= 17) {
    // Every-2-weeks pay keeps exact 14-day gaps on the same weekday;
    // twice-monthly pay keeps the same days of the month instead.
    const exact = gaps.filter((g) => g >= 13 && g <= 15).length / gaps.length;
    const wd = new Map<number, number>();
    for (const d of dates) wd.set(weekday(d), (wd.get(weekday(d)) ?? 0) + 1);
    const sameWeekday = Math.max(...wd.values()) / dates.length;
    if (exact >= 0.75 && sameWeekday >= 0.75) {
      frequency = 'biweekly';
      anchor_date = last;
    } else {
      const [lo, hi] = twoPaydays(dates.map(dayOfMonth));
      if (!lo.length || !hi.length) return null;
      frequency = 'semimonthly';
      day1 = nominalDay(lo);
      day2 = nominalDay(hi);
      if (day1 === day2) return null;
      shift = weekendShift(dates, [day1, day2]);
    }
  } else if (gap >= 26 && gap <= 35) {
    frequency = 'monthly';
    day1 = nominalDay(dates.map(dayOfMonth));
    shift = weekendShift(dates, [day1]);
  } else {
    return null;
  }

  // Typical amount: recent checks, ignoring bonuses and short checks.
  const recent = amounts.slice(-6);
  const mid = median(recent);
  const typical = recent.filter((a) => Math.abs(a - mid) <= 0.35 * mid);
  const average = Math.round((typical.reduce((s, a) => s + a, 0) / typical.length) * 100) / 100;
  const low = Math.round(Math.min(...typical) * 100) / 100;

  return {
    frequency,
    anchor_date,
    day1,
    day2,
    weekend_shift: shift,
    average,
    low,
    last_amount: Math.round(amounts.at(-1)! * 100) / 100,
    last_paid: last,
    occurrences: dates.length,
    active: daysBetween(last, today) <= CYCLE_DAYS[frequency] * 1.6 + 3,
  };
}

/** Days from `from`, for callers that need a lookback start date. */
export function daysAgo(today: ISODate, days: number): ISODate {
  return fromTime(toTime(today) - days * DAY);
}
