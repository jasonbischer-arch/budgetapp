import { buildPaycheckPlan, paydays, dueDates, detectIncome, addDays } from "../src/lib/schedule.ts";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); };

const me = { id: "me", name: "Jason", amount: 2000, frequency: "biweekly" as const, anchor_date: "2026-11-13", day1: null, day2: null };
const wife = { id: "w", name: "Wife", amount: 1600, frequency: "semimonthly" as const, anchor_date: null, day1: 7, day2: 22 };

// The user's example: on the 23rd, only one check is left (his on the 27th).
const rest = [...paydays(me, "2026-11-23", "2026-11-30"), ...paydays(wife, "2026-11-23", "2026-11-30")];
assert(rest.length === 1 && rest[0].date === "2026-11-27" && rest[0].name === "Jason", "on Nov 23 only the Nov 27 check remains");

const dec = [...paydays(me, "2026-12-01", "2026-12-31"), ...paydays(wife, "2026-12-01", "2026-12-31")].map(p => p.date).sort();
assert(JSON.stringify(dec) === JSON.stringify(["2026-12-07","2026-12-11","2026-12-22","2026-12-25"]), "December paydays: " + dec.join(", "));
assert(paydays(wife, "2027-02-01", "2027-02-28").length === 2, "semimonthly in February");
const m31 = { id: "x", name: "x", amount: 1, frequency: "monthly" as const, anchor_date: null, day1: 31, day2: null };
assert(paydays(m31, "2027-02-01", "2027-02-28")[0].date === "2027-02-28", "day 31 clamps to Feb 28");

const yearly = { id: "ins", name: "Car insurance", amount: 900, frequency: "yearly" as const, due_day: 15, due_month: 3 };
assert(dueDates(yearly, "2027-01-01", "2027-12-31").length === 1, "yearly bill once a year");
const q = { id: "q", name: "Water", amount: 120, frequency: "quarterly" as const, due_day: 10, due_month: 2 };
assert(dueDates(q, "2027-01-01", "2027-12-31").map(o => o.date.slice(5,7)).join(",") === "02,05,08,11", "quarterly from Feb");

const bills = [
  { id: "rent", name: "Rent", amount: 1800, frequency: "monthly" as const, due_day: 1, due_month: null },
  { id: "car", name: "Car", amount: 400, frequency: "monthly" as const, due_day: 15, due_month: null },
  { id: "util", name: "Utilities", amount: 220, frequency: "monthly" as const, due_day: 20, due_month: null },
  { id: "phone", name: "Phone", amount: 90, frequency: "monthly" as const, due_day: 10, due_month: null },
  { id: "card", name: "Credit card", amount: 600, frequency: "monthly" as const, due_day: 25, due_month: null },
  { id: "net", name: "Internet", amount: 80, frequency: "monthly" as const, due_day: 5, due_month: null },
];
const plan = buildPaycheckPlan([me, wife], bills, "2026-11-23", "2027-01-31");
for (const c of plan.checks) console.log(`  ${c.date} ${c.name.padEnd(6)} $${c.amount}  bills $${c.billsTotal.toFixed(0).padStart(5)}  left $${c.leftover.toFixed(0).padStart(5)}  [${c.bills.map(b => b.name + (b.split ? " $" + b.amount : "") + " " + b.date.slice(5)).join(", ")}]`);
console.log("  from cash:", plan.fromCash.map(b => b.name + " " + b.date).join(", ") || "none", " target ~", plan.target.toFixed(0));

for (const c of plan.checks) for (const b of c.bills) {
  assert(c.date <= b.date, `${b.name} ${b.date} paid on/before due from ${c.date}`);
}
const lefts = plan.checks.map(c => c.leftover);
console.log("  leftover spread $" + (Math.max(...lefts) - Math.min(...lefts)).toFixed(0));
assert(plan.checks.every(c => c.leftover > 0), "no check goes negative");

// Detection
const tx: { date: string; amount: number; description: string; merchant: string | null }[] = [];
for (let d = "2026-05-01"; d <= "2026-11-20"; d = addDays(d, 14)) tx.push({ date: d, amount: 2000, description: "ACME CORP PAYROLL 1234", merchant: null });
for (const m of ["06","07","08","09","10","11"]) for (const day of ["07","22"]) tx.push({ date: `2026-${m}-${day}`, amount: 1600, description: "GUSTO PAY 99881", merchant: null });
tx.push({ date: "2026-09-03", amount: 250, description: "VENMO", merchant: null });
const sug = detectIncome(tx);
console.log("  detected:", JSON.stringify(sug));
assert(sug.some(s => s.frequency === "biweekly" && s.amount === 2000), "detects biweekly paycheck");
assert(sug.some(s => s.frequency === "semimonthly" && s.day1 === 7 && s.day2 === 22), "detects 7th/22nd paycheck");
assert(!sug.some(s => s.name.includes("Venmo")), "ignores one-off deposits");
