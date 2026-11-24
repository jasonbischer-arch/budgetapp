import { commissionTakeHome, STATES } from "../src/lib/taxes.ts";
import { expenseBreakdown } from "../src/lib/insights.ts";
import type { FlowRowLike, CategoryLike } from "../src/lib/insights.ts";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); };
const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

// --- Commission take-home -------------------------------------------------
const tx = commissionTakeHome({ gross: 10000, state: "TX" });
assert(near(tx.withheld, 2965) && near(tx.net, 7035), "Texas: 22% + 7.65% FICA, no state tax -> $7,035: " + tx.net);
assert(tx.lines.length === 3, "Texas shows federal, Social Security, Medicare only");

const ca = commissionTakeHome({ gross: 10000, state: "CA" });
assert(near(ca.withheld, 2200 + 620 + 145 + 660 + 120), "California adds 6.6% state + 1.2% SDI: " + ca.withheld);
assert(near(ca.totalRate, 37.45), "California total rate 37.45%: " + ca.totalRate);

const k = commissionTakeHome({ gross: 10000, state: "IL", retirementPct: 10 });
// 401k 1000 is pre-tax: federal/state on 9000; FICA on 10000.
assert(near(k.withheld, 1980 + 620 + 145 + 445.5 + 1000), "401(k) lowers federal/state but not FICA: " + k.withheld);

const o = commissionTakeHome({ gross: 5000, state: "NY", overrideRate: 30 });
assert(near(o.net, 3500) && o.lines.length === 1, "your own rate replaces the estimate");

assert(commissionTakeHome({ gross: 4000, state: null }).lines.length === 3, "no state chosen: federal + FICA only");
assert(commissionTakeHome({ gross: 0, state: "CA" }).net === 0, "zero commission is zero");
assert(Object.keys(STATES).length === 51, "all 50 states + DC");

// --- Fixed vs variable breakdown ---------------------------------------------
const cats: CategoryLike[] = [
  { id: "util", name: "Utilities", kind: "expense", expense_type: "fixed", provider_categories: [], monthly_budget: null },
  { id: "ent", name: "Entertainment", kind: "expense", expense_type: "variable", provider_categories: [], monthly_budget: null },
  { id: "groc", name: "Groceries", kind: "expense", expense_type: "variable", provider_categories: [], monthly_budget: null },
];
const months = new Set(["2026-10-01", "2026-09-01"]);
const rows: FlowRowLike[] = [];
for (const m of months) {
  rows.push({ month: m, flow: "spending", category_id: "util", total: -300 });
  rows.push({ month: m, flow: "spending", category_id: "ent", total: -60 });
  rows.push({ month: m, flow: "spending", category_id: "groc", total: -800 });
}
const split = expenseBreakdown(rows, cats, months, [
  { id: "b1", name: "Electric", monthly: 150, category_id: "util", expense_type: "fixed" },
  { id: "b2", name: "Netflix", monthly: 20, category_id: "ent", expense_type: "fixed" },
  { id: "b3", name: "Car loan", monthly: 425.67, category_id: null, expense_type: "fixed" },
]);
assert(near(split.fixed.total, 150 + 20 + 425.67 + 150), "fixed = bills + unbilled rest of fixed categories: " + split.fixed.total);
assert(near(split.variable.total, 40 + 800), "variable doesn't double count the Netflix bill: " + split.variable.total);
assert(split.fixed.items.some((i) => i.kind === "category" && i.name === "Utilities" && near(i.monthly, 150)), "Utilities' unbilled $150 listed under fixed");

const moved = expenseBreakdown(rows, cats, months, [
  { id: "b1", name: "Electric", monthly: 150, category_id: "util", expense_type: "variable" },
]);
assert(near(moved.fixed.total, 150) && near(moved.variable.total, 150 + 60 + 800), "moving a bill to variable moves its amount, total unchanged");
