// Estimates for assets you track yourself (a 401k, pension, HSA, home...).
// Same math as public.asset_estimate() in the database, which net worth uses.

const DAY = 86_400_000;
const MONTH_DAYS = 30.436875;

/**
 * Value today from the balance you entered on `valueDate`: grown at the
 * yearly return, plus each month's contribution grown from when it went in.
 */
export function assetEstimate(opts: {
  value: number;
  valueDate: string; // YYYY-MM-DD
  annualPct: number;
  monthly?: number;
  today: string; // YYYY-MM-DD
}): number {
  const days = (Date.parse(opts.today) - Date.parse(opts.valueDate)) / DAY;
  const months = Math.max(0, days / MONTH_DAYS);
  const r = Math.pow(1 + opts.annualPct / 100, 1 / 12) - 1;
  const grown = opts.value * Math.pow(1 + r, months);
  const c = opts.monthly ?? 0;
  const added = Math.abs(r) < 1e-12 ? c * months : (c * (Math.pow(1 + r, months) - 1)) / r;
  return Math.round((grown + added) * 100) / 100;
}

/** The same estimate `months` months from now (for "in a year…"). */
export function assetProjection(value: number, annualPct: number, monthly: number, months: number) {
  const r = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  const added = Math.abs(r) < 1e-12 ? monthly * months : (monthly * (Math.pow(1 + r, months) - 1)) / r;
  return Math.round((value * Math.pow(1 + r, months) + added) * 100) / 100;
}
