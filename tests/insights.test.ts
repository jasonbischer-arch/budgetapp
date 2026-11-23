import { trailingAverages, totalsFor, periodMonths, spendingByCategory, cutSuggestions } from "../src/lib/insights.ts";
import type { FlowRowLike } from "../src/lib/insights.ts";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); };
const now = new Date(2026, 10, 23, 12); // Nov 23, 2026

const rows: FlowRowLike[] = [];
const months = ["2026-11-01","2026-10-01","2026-09-01","2026-08-01","2026-07-01","2026-06-01","2026-05-01"];
const dining = [300, 500, 420, 610, 380, 450, 520]; // newest first
months.forEach((m, i) => {
  rows.push({ month: m, flow: "income", category_id: "inc", total: 7000 });
  rows.push({ month: m, flow: "spending", category_id: "dine", total: -dining[i] });
  rows.push({ month: m, flow: "spending", category_id: "rent", total: -1800 });
  rows.push({ month: m, flow: "saved", category_id: "sav", total: -500 });
  rows.push({ month: m, flow: "refund", category_id: "dine", total: 20 });
});

// History started May 15 -> May is partial; complete months Jun..Oct = 5.
const avg = trailingAverages(rows, now, "2026-05-15");
assert(avg.months === 5, "counts 5 complete months (skips partial May and current Nov): " + avg.months);
assert(avg.income === 7000, "average income 7000");
const expectedSpent = (500 + 420 + 610 + 380 + 450) / 5 + 1800 - 20;
assert(Math.abs(avg.spent - expectedSpent) < 0.01, "average spent nets refunds: " + avg.spent.toFixed(2));
assert(avg.saved === 500, "savings transfers are 'saved', not spent");

const t3 = totalsFor(rows, periodMonths(now, 3));
assert(t3.income === 21000 && t3.saved === 1500, "3-month totals include the current month");
assert(Math.abs(t3.net - (21000 - t3.spent)) < 0.01, "net = income - spent");

const cats = spendingByCategory(rows, periodMonths(now, 1));
assert(cats[0].categoryId === "rent" && cats[1].amount === 280, "category totals ranked, refunds subtracted");

const sugg = cutSuggestions(rows, [
  { id: "dine", name: "Dining", kind: "expense", provider_categories: ["FOOD_AND_DRINK"], monthly_budget: null },
  { id: "rent", name: "Rent", kind: "expense", provider_categories: ["RENT_AND_UTILITIES_RENT"], monthly_budget: null },
], now);
console.log("  ", JSON.stringify(sugg));
assert(sugg.length === 1 && sugg[0].categoryId === "dine", "suggests dining, never rent");
assert(sugg[0].target < sugg[0].average && sugg[0].target >= sugg[0].average * 0.7 - 10, "cut is at most ~30%");
