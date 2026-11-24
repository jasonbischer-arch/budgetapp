// Bill detection: finds regular monthly payments out of checking (car loan,
// mortgage, rent, utilities, insurance, subscriptions) and works out the
// amount, the day it's due, and whether it's a debt.
//
// Pure TypeScript: runs in the Edge Functions and the test suite
// (tests/bills-detect.test.ts).

import { payerKey } from './paychecks.ts';

export interface Payment {
  date: string; // YYYY-MM-DD
  amount: number; // positive = money out
  description: string;
  merchant: string | null;
  category_detailed?: string | null;
  category_id?: string | null;
}

export type DebtKind = 'auto_loan' | 'mortgage' | 'student_loan' | 'personal_loan' | 'other';

export interface DetectedBill {
  key: string;
  name: string;
  /** Typical amount: the latest when steady, else the average of the last 3. */
  amount: number;
  due_day: number;
  last_paid: string;
  occurrences: number;
  is_debt: boolean;
  debt_kind: DebtKind | null;
  category_id: string | null;
  /** Still being paid (seen in the last ~45 days). */
  active: boolean;
}

const DAY = 86_400_000;
const toTime = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

function debtKind(category: string | null | undefined): DebtKind | null {
  switch (category) {
    case 'LOAN_PAYMENTS_CAR_PAYMENT':
      return 'auto_loan';
    case 'LOAN_PAYMENTS_MORTGAGE_PAYMENT':
      return 'mortgage';
    case 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT':
      return 'student_loan';
    case 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT':
      return 'personal_loan';
    case 'LOAN_PAYMENTS_OTHER_PAYMENT':
      return 'other';
    default:
      return null;
  }
}

const KIND_LABEL: Record<DebtKind, string> = {
  auto_loan: 'car loan',
  mortgage: 'mortgage',
  student_loan: 'student loan',
  personal_loan: 'personal loan',
  other: 'loan',
};

/** Splits a payee's payments into amount bands (two loans at one lender). */
function bands(items: Payment[]): Payment[][] {
  const out: Payment[][] = [];
  for (const p of [...items].sort((a, b) => b.amount - a.amount)) {
    const band = out.find((b) => {
      const m = median(b.map((x) => x.amount));
      return Math.abs(p.amount - m) <= 0.35 * m; // utilities vary month to month
    });
    if (band) band.push(p);
    else out.push([p]);
  }
  return out;
}

/** The most common non-null value (null if there is none). */
function mostCommon<T>(xs: (T | null)[]): T | null {
  const counts = new Map<T, number>();
  for (const x of xs) if (x != null) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [x, n] of counts) if (n > bestCount) [best, bestCount] = [x, n];
  return best;
}

/** The most common value; ties go to the later day. */
function mode(xs: number[]) {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/**
 * Finds monthly bills: the same payee at least 3 times, $5 or more, about a
 * month apart. Loans are flagged as debts from Plaid's category.
 */
export function detectBills(payments: Payment[], today: string): DetectedBill[] {
  const byPayee = new Map<string, Payment[]>();
  for (const p of payments) {
    if (!(p.amount >= 5)) continue;
    const key = payerKey(p);
    if (!key) continue;
    byPayee.set(key, [...(byPayee.get(key) ?? []), p]);
  }

  const out: DetectedBill[] = [];
  for (const [payee, items] of byPayee) {
    const groups = bands(items).filter((b) => b.length >= 3);
    groups.forEach((band, i) => {
      // One payment per day.
      const byDate = new Map<string, Payment>();
      for (const p of band) byDate.set(p.date, p);
      const dates = [...byDate.keys()].sort();
      if (dates.length < 3) return;
      const gaps = dates.slice(1).map((d, j) => daysBetween(dates[j], d));
      const gap = median(gaps);
      if (gap < 25 || gap > 36) return; // monthly only

      const recent = dates.slice(-3).map((d) => byDate.get(d)!.amount);
      const last = recent.at(-1)!;
      const steady = Math.max(...recent) - Math.min(...recent) <= Math.max(1, 0.03 * last);
      const amount = Math.round((steady ? last : recent.reduce((s, a) => s + a, 0) / recent.length) * 100) / 100;

      const kind = debtKind(mostCommon(dates.map((d) => byDate.get(d)!.category_detailed ?? null)));
      const categoryId = mostCommon(dates.map((d) => byDate.get(d)!.category_id ?? null));

      const base = titleCase(payee);
      const name = kind ? `${base} (${KIND_LABEL[kind]})` : base;
      out.push({
        key: groups.length > 1 ? `${payee}#${i + 1}` : payee,
        name: groups.length > 1 && !kind ? `${name} (~$${Math.round(amount)})` : name,
        amount,
        due_day: mode(dates.map((d) => +d.slice(8, 10))),
        last_paid: dates.at(-1)!,
        occurrences: dates.length,
        is_debt: !!kind,
        debt_kind: kind,
        category_id: categoryId,
        active: daysBetween(dates.at(-1)!, today) <= 45,
      });
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/**
 * Finds the connected loan account a payment goes to, by lender name
 * (e.g. payments to "ALLY" match the "Ally Auto" loan account).
 */
export function matchLoanAccount(
  billKey: string,
  accounts: { id: string; name: string; institution_name: string | null; subtype: string | null }[],
  kind: DebtKind | null,
): string | null {
  const words = billKey.replace(/#\d+$/, '').split(' ').filter((w) => w.length >= 3);
  const candidates = accounts.filter((a) => {
    const hay = `${a.name} ${a.institution_name ?? ''}`.toUpperCase();
    return words.some((w) => hay.includes(w));
  });
  if (candidates.length === 1) return candidates[0].id;
  // Several loans at one lender: prefer the matching type.
  const want = kind === 'auto_loan' ? 'auto' : kind === 'mortgage' ? 'mortgage' : kind === 'student_loan' ? 'student' : null;
  return candidates.find((a) => want && a.subtype === want)?.id ?? null;
}
