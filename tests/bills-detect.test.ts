import { detectBills, matchLoanAccount, type Payment } from "../supabase/functions/_shared/bills-detect.ts";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); };
const today = "2026-11-24";
const p: Payment[] = [];
const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];

// Ally car payment, $425.67 on the 15th (ACH text varies a little).
for (const m of months) p.push({ date: `${m}-15`, amount: 425.67, description: `ALLY ALLY PAYMT ${m.replace("-", "")} PPD ID: 9833122`, merchant: "Ally", category_detailed: "LOAN_PAYMENTS_CAR_PAYMENT", category_id: "loans" });
// Mortgage, $1,812.40 on the 1st.
for (const m of months) p.push({ date: `${m}-01`, amount: 1812.4, description: "ROCKET MORTGAGE ONLINE PMT", merchant: "Rocket Mortgage", category_detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", category_id: "loans" });
// Electric bill that varies.
const electric = [142.1, 118.75, 160.3, 171.2, 149.9, 121.35, 98.4];
months.forEach((m, i) => p.push({ date: `${m}-${i % 2 ? "20" : "21"}`, amount: electric[i], description: "DUKE ENERGY WEB PAY", merchant: "Duke Energy", category_detailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY", category_id: "util" }));
// Weekly groceries (not a monthly bill).
for (let d = Date.parse("2026-05-02"); d < Date.parse(today); d += 7 * 86400000) p.push({ date: new Date(d).toISOString().slice(0, 10), amount: 180, description: "KROGER #123", merchant: "Kroger", category_detailed: "FOOD_AND_DRINK_GROCERIES" });
// A gym membership that was cancelled in July.
for (const m of ["2026-04", "2026-05", "2026-06", "2026-07"]) p.push({ date: `${m}-03`, amount: 49.99, description: "PLANET FITNESS", merchant: "Planet Fitness", category_detailed: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS" });
// One-offs.
p.push({ date: "2026-09-09", amount: 900, description: "BEST BUY", merchant: "Best Buy" });

const bills = detectBills(p, today);
for (const b of bills) console.log("  ", JSON.stringify(b));

const ally = bills.find((b) => b.key.startsWith("ALLY"));
assert(ally && ally.amount === 425.67 && ally.due_day === 15, "Ally car payment: $425.67 on the 15th");
assert(ally?.is_debt && ally.debt_kind === "auto_loan" && ally.name === "Ally (car loan)", "flagged as a car loan debt");
assert(ally?.category_id === "loans", "keeps the household category");

const mortgage = bills.find((b) => b.debt_kind === "mortgage");
assert(mortgage?.amount === 1812.4 && mortgage.due_day === 1, "mortgage $1,812.40 on the 1st");

const duke = bills.find((b) => b.key.startsWith("DUKE"));
assert(duke && !duke.is_debt && Math.abs(duke.amount - (149.9 + 121.35 + 98.4) / 3) < 0.01, "varying utility uses the 3-month average: " + duke?.amount);
assert(duke?.due_day === 21 || duke?.due_day === 20, "utility due around the 20th");

assert(!bills.some((b) => b.key.startsWith("KROGER")), "weekly groceries aren't a monthly bill");
const gym = bills.find((b) => b.key.startsWith("PLANET"));
assert(gym && gym.active === false, "cancelled gym marked inactive");
assert(!bills.some((b) => b.key.startsWith("BEST")), "one-off purchases ignored");

const accounts = [
  { id: "ally-acct", name: "Auto Loan", institution_name: "Ally Bank", subtype: "auto" },
  { id: "chase-card", name: "Sapphire", institution_name: "Chase", subtype: "credit card" },
];
assert(matchLoanAccount("ALLY", accounts, "auto_loan") === "ally-acct", "links Ally payments to the connected Ally loan");
assert(matchLoanAccount("ROCKET MORTGAGE", accounts, "mortgage") === null, "no false link when the lender isn't connected");
