import { amortizedBalance, currentBalance, paymentsSince, payoff } from "../src/lib/debt.ts";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); };

// Same answers as the database functions (checked on the live project).
assert(paymentsSince("2026-11-10", 15, "2026-11-14") === 0, "before the first due date: 0 payments");
assert(paymentsSince("2026-11-10", 15, "2026-11-15") === 1, "on the due date: 1 payment");
assert(paymentsSince("2026-11-20", 15, "2026-12-20") === 1, "a month later: 1 payment");
assert(paymentsSince("2026-01-20", 31, "2026-02-28") === 2, "due the 31st counts Feb 28");
assert(amortizedBalance(14625, 6.9, 425.67, 1) === 14283.42, "Tiguan after 1 payment: $14,283.42");
assert(amortizedBalance(14625, 6.9, 425.67, 12) === 10393.94, "after 12 payments: $10,393.94");
assert(amortizedBalance(14625, 0, 425.67, 12) === 9516.96, "no interest: straight subtraction");
assert(amortizedBalance(14625, 6.9, 425.67, 60) === 0, "never below zero");

const p = payoff(14625, 6.9, 425.67, "2026-11-24");
console.log("  ", JSON.stringify(p));
assert(p.months === 39, "Tiguan paid off in 39 months (38.4, last one partial): " + p.months);
assert(p.nextInterest === 84.09 && p.nextPrincipal === 341.58, "next payment: $84.09 interest, $341.58 principal");
// Total paid (38.38 payments x $425.67) minus the $14,625 owed ~= $1,713.
assert(Math.abs(p.interest - 1713) < 10, "about $1,713 interest left: " + p.interest);
assert(payoff(10000, 24, 150, "2026-11-24").months === null, "payment below interest never pays off");

assert(currentBalance({ balance: 14625, apr: 6.9, payment: 425.67, balanceDate: "2026-11-01", dueDay: 15, today: "2026-12-20" }) === amortizedBalance(14625, 6.9, 425.67, 2),
  "balance entered Nov 1 has two payments by Dec 20");

// --- Assets you track yourself (401k etc.): matches the database -------------
{
  const { assetEstimate, assetProjection } = await import("../src/lib/growth.ts");
  // public.asset_estimate(50000, current_date - 365, 6, 1000) = 65316.05
  const v = assetEstimate({ value: 50000, valueDate: "2025-11-25", annualPct: 6, monthly: 1000, today: "2026-11-25" });
  assert(Math.abs(v - 65316.05) < 0.02, "401k: $50k + $1,000/mo at 6% for a year = $65,316 (same as the database): " + v);
  // No contributions: the old yearly formula. GMC: 32500 at -15% since Nov 24 = 32485.54 on Nov 25.
  const gmc = assetEstimate({ value: 32500, valueDate: "2026-11-24", annualPct: -15, today: "2026-11-25" });
  assert(Math.abs(gmc - 32485.54) < 0.02, "without contributions it matches the old formula: " + gmc);
  assert(assetEstimate({ value: 1000, valueDate: "2026-11-25", annualPct: 0, monthly: 100, today: "2027-11-25" }) > 2190, "0% return still adds contributions");
  assert(Math.abs(assetProjection(50000, 6, 1000, 12) - 65339) < 30, "a year from now projection");
}
