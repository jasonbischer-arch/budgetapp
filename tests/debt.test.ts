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
