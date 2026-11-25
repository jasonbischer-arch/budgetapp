// Take-home estimate for commission (and bonus) pay.
//
// Employers usually withhold on commission paid separately from salary as
// "supplemental wages": a flat 22% federal rate, Social Security and
// Medicare, and the state's supplemental rate (or roughly its top/typical
// rate where the state has none). This is what comes out of the check, not
// what you'll owe at tax time. Local/city taxes aren't included.
//
// Rates are 2025 figures; states change them. Everything here can be
// overridden in the app.

export const FEDERAL_SUPPLEMENTAL = 22; // % (supplemental wages up to $1M)
export const SOCIAL_SECURITY = 6.2; // %
export const MEDICARE = 1.45; // %

export interface StateTax {
  name: string;
  /** Estimated % withheld on commission. */
  rate: number;
  /** Other required payroll deductions (e.g. state disability), %. */
  other?: { label: string; rate: number };
  note?: string;
}

export const STATES: Record<string, StateTax> = {
  AL: { name: 'Alabama', rate: 5 },
  AK: { name: 'Alaska', rate: 0 },
  AZ: { name: 'Arizona', rate: 2.5 },
  AR: { name: 'Arkansas', rate: 3.9 },
  CA: { name: 'California', rate: 6.6, other: { label: 'CA disability (SDI)', rate: 1.2 }, note: 'Bonuses are withheld at 10.23%.' },
  CO: { name: 'Colorado', rate: 4.4 },
  CT: { name: 'Connecticut', rate: 6.99 },
  DE: { name: 'Delaware', rate: 5.55 },
  DC: { name: 'District of Columbia', rate: 8.5 },
  FL: { name: 'Florida', rate: 0 },
  GA: { name: 'Georgia', rate: 5.19 },
  HI: { name: 'Hawaii', rate: 7.2 },
  ID: { name: 'Idaho', rate: 5.7 },
  IL: { name: 'Illinois', rate: 4.95 },
  IN: { name: 'Indiana', rate: 3, note: 'County tax (about 1–3%) not included.' },
  IA: { name: 'Iowa', rate: 3.8 },
  KS: { name: 'Kansas', rate: 5 },
  KY: { name: 'Kentucky', rate: 4 },
  LA: { name: 'Louisiana', rate: 3 },
  ME: { name: 'Maine', rate: 5 },
  MD: { name: 'Maryland', rate: 5.75, note: 'County tax (about 2.25–3.2%) not included.' },
  MA: { name: 'Massachusetts', rate: 5 },
  MI: { name: 'Michigan', rate: 4.25 },
  MN: { name: 'Minnesota', rate: 6.25 },
  MS: { name: 'Mississippi', rate: 4.4 },
  MO: { name: 'Missouri', rate: 4.7 },
  MT: { name: 'Montana', rate: 5 },
  NE: { name: 'Nebraska', rate: 5 },
  NV: { name: 'Nevada', rate: 0 },
  NH: { name: 'New Hampshire', rate: 0 },
  NJ: { name: 'New Jersey', rate: 5.5 },
  NM: { name: 'New Mexico', rate: 4.9 },
  NY: { name: 'New York', rate: 11.7, note: 'NYC/Yonkers tax not included.' },
  NC: { name: 'North Carolina', rate: 4.25 },
  ND: { name: 'North Dakota', rate: 1.5 },
  OH: { name: 'Ohio', rate: 3.5, note: 'City tax not included.' },
  OK: { name: 'Oklahoma', rate: 4.75 },
  OR: { name: 'Oregon', rate: 8 },
  PA: { name: 'Pennsylvania', rate: 3.07, note: 'Local earned-income tax not included.' },
  RI: { name: 'Rhode Island', rate: 5.99 },
  SC: { name: 'South Carolina', rate: 6.2 },
  SD: { name: 'South Dakota', rate: 0 },
  TN: { name: 'Tennessee', rate: 0 },
  TX: { name: 'Texas', rate: 0 },
  UT: { name: 'Utah', rate: 4.5 },
  VT: { name: 'Vermont', rate: 6 },
  VA: { name: 'Virginia', rate: 5.75 },
  WA: { name: 'Washington', rate: 0 },
  WV: { name: 'West Virginia', rate: 4.82 },
  WI: { name: 'Wisconsin', rate: 5.3 },
  WY: { name: 'Wyoming', rate: 0 },
};

export interface TaxLine {
  label: string;
  rate: number; // %
  amount: number;
}

export interface TakeHome {
  gross: number;
  lines: TaxLine[];
  /** Total withheld, % of gross. */
  totalRate: number;
  withheld: number;
  net: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Estimated take-home from a commission check.
 *
 * retirementPct: pre-tax 401(k) %. It lowers federal and state withholding
 * (not Social Security or Medicare), like a real paycheck.
 * overrideRate: a total withholding % from your own paystub; when set it
 * replaces the tax estimate (retirement still comes out on top).
 */
export function commissionTakeHome(opts: {
  gross: number;
  state: string | null;
  retirementPct?: number;
  overrideRate?: number | null;
}): TakeHome {
  const gross = Math.max(0, opts.gross || 0);
  const retirementPct = Math.min(75, Math.max(0, opts.retirementPct ?? 0));
  const retirement = gross * (retirementPct / 100);
  const taxable = gross - retirement;
  const lines: TaxLine[] = [];
  const add = (label: string, rate: number, base: number) => {
    if (rate > 0) lines.push({ label, rate, amount: round2((base * rate) / 100) });
  };

  if (opts.overrideRate != null) {
    add('Taxes (your rate)', opts.overrideRate, gross);
  } else {
    const st = opts.state ? STATES[opts.state] : undefined;
    add('Federal (22% supplemental)', FEDERAL_SUPPLEMENTAL, taxable);
    add('Social Security', SOCIAL_SECURITY, gross);
    add('Medicare', MEDICARE, gross);
    if (st) {
      add(`${st.name} state tax`, st.rate, taxable);
      if (st.other) add(st.other.label, st.other.rate, gross);
    }
  }
  add('401(k) / retirement', retirementPct, gross);

  const withheld = round2(lines.reduce((s, l) => s + l.amount, 0));
  return {
    gross,
    lines,
    totalRate: gross > 0 ? round2((withheld / gross) * 100) : 0,
    withheld,
    net: round2(gross - withheld),
  };
}

/**
 * Monthly commission to budget with: the take-home of your slow month (the
 * lower estimate), so the budget still works when commission is low.
 */
export function budgetCommission(opts: {
  low: number | null;
  high: number | null;
  state: string | null;
  retirementPct?: number;
}) {
  const amounts = [opts.low, opts.high].filter((x): x is number => x != null && x > 0);
  if (!amounts.length) return { gross: 0, net: 0, lowNet: 0, highNet: 0 };
  const net = (g: number) => commissionTakeHome({ gross: g, state: opts.state, retirementPct: opts.retirementPct }).net;
  const gross = Math.min(...amounts);
  return {
    gross,
    net: net(gross),
    lowNet: net(Math.min(...amounts)),
    highNet: net(Math.max(...amounts)),
  };
}
