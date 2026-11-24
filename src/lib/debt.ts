// Debt pay-down math. Matches the database's amortized_balance() and
// payments_since(), so the app and net worth always agree.

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

/** Due dates (day `dueDay`, clamped to month length) passed after `from`, up to `to`. */
export function paymentsSince(from: string, dueDay: number, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const months = (ty - fy) * 12 + (tm - fm);
  const toPast = td >= Math.min(dueDay, lastDay(ty, tm - 1)) ? 1 : 0;
  const fromPast = fd >= Math.min(dueDay, lastDay(fy, fm - 1)) ? 1 : 0;
  return Math.max(0, months + toPast - fromPast);
}

/** Balance after `n` monthly payments: interest added each month, payment subtracted. */
export function amortizedBalance(balance: number, apr: number, payment: number, n: number): number {
  if (payment <= 0 || n <= 0) return balance;
  if (!apr) return Math.max(0, balance - payment * n);
  const r = apr / 1200;
  const g = Math.pow(1 + r, n);
  return Math.max(0, Math.round((balance * g - (payment * (g - 1)) / r) * 100) / 100);
}

export interface Payoff {
  /** Months until the balance reaches zero; null if the payment never covers the interest. */
  months: number | null;
  /** Total interest still to pay. */
  interest: number;
  /** First interest charge vs principal for the next payment. */
  nextInterest: number;
  nextPrincipal: number;
  payoffDate: string | null; // YYYY-MM
}

/** How long a debt takes to pay off at this payment, and the interest it costs. */
export function payoff(balance: number, apr: number, payment: number, today: string): Payoff {
  const r = (apr || 0) / 1200;
  const nextInterest = Math.round(balance * r * 100) / 100;
  if (balance <= 0) return { months: 0, interest: 0, nextInterest: 0, nextPrincipal: 0, payoffDate: today.slice(0, 7) };
  if (payment <= nextInterest) {
    return { months: null, interest: Infinity, nextInterest, nextPrincipal: 0, payoffDate: null };
  }
  const months = r === 0 ? Math.ceil(balance / payment) : Math.ceil(-Math.log(1 - (r * balance) / payment) / Math.log(1 + r));
  // Sum each month's interest (the last payment is just a partial one).
  let b = balance;
  let interest = 0;
  for (let i = 0; i < months; i++) {
    const int = b * r;
    interest += int;
    b = b + int - payment;
  }
  const [y, m] = today.split('-').map(Number);
  const end = new Date(y, m - 1 + months, 1);
  return {
    months,
    interest: Math.round(interest * 100) / 100,
    nextInterest,
    nextPrincipal: Math.round((payment - nextInterest) * 100) / 100,
    payoffDate: `${end.getFullYear()}-${pad(end.getMonth() + 1)}`,
  };
}

/** A manual debt's balance today, from the balance entered on `balanceDate`. */
export function currentBalance(opts: {
  balance: number | null;
  apr: number | null;
  payment: number | null;
  balanceDate: string | null;
  dueDay: number;
  today: string;
}): number | null {
  if (opts.balance == null) return null;
  const n = paymentsSince(opts.balanceDate ?? opts.today, opts.dueDay, opts.today);
  return amortizedBalance(opts.balance, opts.apr ?? 0, opts.payment ?? 0, n);
}
