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
assert(near(split.fixed.total, 150 + 20 + 425.67), "fixed = exactly your fixed bills: " + split.fixed.total);
assert(near(split.variable.total, 40 + 800), "variable doesn't double count the Netflix bill: " + split.variable.total);
assert(split.fixed.items.every((i) => i.kind === "bill"), "fixed lists only bills");

const moved = expenseBreakdown(rows, cats, months, [
  { id: "b1", name: "Electric", monthly: 150, category_id: "util", expense_type: "variable" },
]);
assert(near(moved.fixed.total, 0) && near(moved.variable.total, 150 + 60 + 800), "moving a bill to variable moves its amount");

// --- Payees you could add as fixed expenses ----------------------------------
{
  const { payeesToAdd, payeeKey } = await import("../src/lib/insights.ts");
  const tx = (date: string, amount: number, description: string, merchant: string | null = null, category_id: string | null = "cc") =>
    ({ date, amount, description, merchant, category_id });
  const rows = [
    tx("2026-09-05", -850, "BRIGHT HORIZONS PAYMENT", "Bright Horizons"),
    tx("2026-10-05", -850, "BRIGHT HORIZONS PAYMENT", "Bright Horizons"),
    tx("2026-11-05", -900, "BRIGHT HORIZONS PAYMENT", "Bright Horizons"),
    tx("2026-11-12", -64.2, "TARGET 1234", "Target", "shop"),
    tx("2026-10-20", -425.67, "ALLY PAYMENT ID 99", null, "loan"),
    tx("2026-11-20", -425.67, "ALLY PAYMENT ID 99", null, "loan"),
    tx("2026-11-21", 50, "REFUND", "Target", "shop"),
  ];
  const list = payeesToAdd(rows, [{ name: "Ally (car loan)", detection_key: "ALLY" }]);
  if (list.some((p) => p.key.startsWith("ALLY"))) throw new Error("FAIL: payee with a bill is left out");
  const bh = list[0];
  if (bh.name !== "Bright Horizons" || !bh.recurring || bh.months !== 3) throw new Error("FAIL: recurring daycare first: " + JSON.stringify(bh));
  if (bh.typical !== 850 || bh.day !== 5 || bh.lastAmount !== 900) throw new Error("FAIL: typical/day/last: " + JSON.stringify(bh));
  const target = list.find((p) => p.name === "Target");
  if (!target || target.recurring || target.count !== 1) throw new Error("FAIL: refunds ignored, one-off not recurring");
  if (payeeKey(null, "ALLY PAYMENT ID 99") !== "ALLY") throw new Error("FAIL: payee key strips filler");
  const weekly = Array.from({ length: 12 }, (_, i) => tx(`2026-${String(9 + Math.floor(i / 4)).padStart(2, "0")}-${String(1 + (i % 4) * 7).padStart(2, "0")}`, -10, "WAWA 123", "Wawa", "food"));
  const w = payeesToAdd(weekly, []).find((p) => p.name === "Wawa");
  if (!w || w.recurring) throw new Error("FAIL: a store visited weekly isn't a bill");
  console.log("ok - payees to add: recurring first, typical amount and day, bills and refunds left out");
}

// --- No double counting: bill payments count as the bill only -----------------
{
  const { expenseBreakdown: eb, cutSuggestions: cs, payeeKey: pk } = await import("../src/lib/insights.ts");
  const health = [{ id: "health", name: "Health", kind: "expense" as const, expense_type: "variable" as const, provider_categories: ["MEDICAL"], monthly_budget: null }];
  const m = new Set(["2026-10-01", "2026-09-01"]);
  const r = [];
  for (const month of m) {
    r.push({ month, flow: "spending" as const, category_id: "health", bill_id: "gok", total: -348.75 });
    r.push({ month, flow: "spending" as const, category_id: "health", bill_id: null, total: -120 });
  }
  const out = eb(r, health, m, [{ id: "gok", name: "Gokadar", monthly: 348.75, category_id: "health", expense_type: "fixed" }]);
  assert(near(out.fixed.total, 348.75), "Gokadar counts once, as the fixed bill");
  assert(near(out.variable.total, 120), "Health shows only its other spending: " + out.variable.total);
  assert(near(out.fixed.total + out.variable.total, 468.75), "fixed + variable = everything spent, once");

  // A bill with no matched payments falls back to subtracting its amount.
  const r2 = [...m].map((month) => ({ month, flow: "spending" as const, category_id: "health", bill_id: null, total: -468.75 }));
  const out2 = eb(r2, health, m, [{ id: "x", name: "Doctor plan", monthly: 348.75, category_id: "health", expense_type: "fixed" }]);
  assert(near(out2.variable.total, 120), "unmatched bill: its amount comes out of the category instead");

  assert(pk(null, "ALLY ALLY PAYMT 228358152146 WEB ID: 9833122002") === "ALLY ALLY PAYMT", "payee key matches the database's rules");
  assert(cs(r, health, new Date(2026, 10, 15)).length === 0, "bill payments aren't suggested as cuts");
}
