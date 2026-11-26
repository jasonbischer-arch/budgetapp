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
  { id: "dine", name: "Dining", kind: "expense", expense_type: "variable", provider_categories: ["FOOD_AND_DRINK"], monthly_budget: null },
  { id: "rent", name: "Rent", kind: "expense", expense_type: "fixed", provider_categories: ["RENT_AND_UTILITIES_RENT"], monthly_budget: null },
], now, "2026-05-15");
console.log("  ", JSON.stringify(sugg));
assert(sugg.length === 1 && sugg[0].categoryId === "dine", "suggests dining, never rent");
assert(sugg[0].target < sugg[0].average && sugg[0].target >= sugg[0].average * 0.7 - 10, "cut is at most ~30%");

assert(!!sugg[0].tip, "each cut comes with a tip");

// Fixed vs variable
import { expenseSplit, paycheckSplit, trailingMonths } from "../src/lib/insights.ts";
const cats2 = [
  { id: "dine", name: "Dining", kind: "expense" as const, expense_type: "variable" as const, provider_categories: ["FOOD_AND_DRINK"], monthly_budget: null },
  { id: "rent", name: "Rent", kind: "expense" as const, expense_type: "fixed" as const, provider_categories: ["RENT_AND_UTILITIES_RENT"], monthly_budget: null },
];
const tm = trailingMonths(now, "2026-05-15");
const split = expenseSplit(rows, cats2, tm, 0);
assert(Math.abs(split.fixed - 1800) < 0.01 && Math.abs(split.variable - (2360 / 5 - 20)) < 0.01, "fixed vs variable from spending: " + JSON.stringify(split));
assert(expenseSplit(rows, cats2, tm, 2400).fixed === 2400, "fixed uses entered bills when present");

// Even savings: $900 typical after bills, $1,300/mo variable over ~2.17 checks/mo
const ps = paycheckSplit({ typicalAfterBills: 900, variablePerMonth: 1300, checksPerMonth: 4.33, savingsOverride: null });
assert(ps.savings === 590 && Math.abs(ps.leftToSpend - 310) < 0.01, "auto savings = after bills - spending per check (rounded to $10): " + JSON.stringify(ps));
assert(paycheckSplit({ typicalAfterBills: 900, variablePerMonth: 1300, checksPerMonth: 4.33, savingsOverride: 200 }).leftToSpend === 700, "your own savings amount wins");
assert(paycheckSplit({ typicalAfterBills: 200, variablePerMonth: 1300, checksPerMonth: 2, savingsOverride: null }).savings === 0, "never suggests negative savings");

// --- Monthly budget check-in -----------------------------------------------
{
  const { budgetHelpDue } = await import("../src/lib/insights.ts");
  const cutsX = [{ categoryId: "dine", target: 400 }, { categoryId: "shop", target: 200 }];
  const nov = new Date(2026, 10, 15, 12);
  const dec1 = new Date(2026, 11, 1, 9);
  const unset = new Map<string, number | null>([["dine", 500], ["shop", null]]);
  const set = new Map<string, number | null>([["dine", 400], ["shop", 200]]);
  if (!budgetHelpDue(cutsX, unset, null, nov)) throw new Error("FAIL: offered when suggestions aren't budgets yet");
  if (budgetHelpDue(cutsX, set, "2026-11-01", nov)) throw new Error("FAIL: hidden for the rest of the month after taking them");
  if (budgetHelpDue(cutsX, unset, "2026-11-01", nov)) throw new Error("FAIL: hidden all month once taken, even if budgets change");
  if (!budgetHelpDue([{ categoryId: "dine", target: 380 }], set, "2026-11-01", dec1)) throw new Error("FAIL: comes back on the 1st with new suggestions");
  if (budgetHelpDue(cutsX, set, "2026-10-01", dec1)) throw new Error("FAIL: nothing to offer when budgets already match");
  console.log("ok - budget check-in: hidden after taking suggestions, back on the 1st");
}

// --- Ways to cut ----------------------------------------------------------------
{
  const { savingsIdeas } = await import("../src/lib/insights.ts");
  const cats = [
    { id: "ent", name: "Entertainment", kind: "expense" as const, expense_type: "variable" as const, provider_categories: ["ENTERTAINMENT"], monthly_budget: null },
    { id: "ins", name: "Insurance", kind: "expense" as const, expense_type: "fixed" as const, provider_categories: ["GENERAL_SERVICES_INSURANCE"], monthly_budget: null },
    { id: "loan", name: "Loans", kind: "expense" as const, expense_type: "fixed" as const, provider_categories: ["LOAN_PAYMENTS"], monthly_budget: null },
    { id: "fees", name: "Bank Fees", kind: "expense" as const, expense_type: "variable" as const, provider_categories: ["BANK_FEES"], monthly_budget: null },
    { id: "home", name: "Rent & Home", kind: "expense" as const, expense_type: "fixed" as const, provider_categories: ["RENT_AND_UTILITIES_RENT"], monthly_budget: null },
  ];
  const ideas = savingsIdeas({
    cuts: [{ categoryId: "dine", name: "Dining", average: 600, target: 450, savings: 150, reason: "", tip: "Cook more." }],
    bills: [
      { id: "netflix", name: "Netflix", monthly: 21.31, category_id: "ent", expense_type: "fixed" },
      { id: "prog", name: "Progressive", monthly: 276.78, category_id: "ins", expense_type: "fixed" },
      { id: "ally", name: "Ally", monthly: 425.67, category_id: "loan", expense_type: "fixed" },
      { id: "mortgage", name: "Mortgage", monthly: 3186, category_id: "home", expense_type: "fixed" },
    ],
    categories: cats,
    debts: [{ billId: "ally", name: "Ally", balance: 14765, apr: 9.79 }, { billId: "gmc", name: "GMC", balance: 42350, apr: 6.24 }],
    categoryAverages: new Map([["fees", 35]]),
  });
  const ids = ideas.map((i) => i.id);
  assert(ids[0] === "budget:dine", "biggest saving first: " + ids.join(", "));
  assert(ids.includes("subscription:netflix") && ids.includes("insurance:prog") && ids.includes("fees:fees"), "subscriptions, insurance and fees found");
  assert(ids.includes("debt:ally") && !ids.includes("debt:gmc"), "only high-interest debt (9.79%, not 6.24%)");
  assert(!ids.some((i) => i.includes("mortgage")), "a mortgage isn't treated as a subscription");
  const ally = ideas.find((i) => i.id === "debt:ally")!;
  assert(Math.abs(ally.monthly - (14765 * (9.79 - 6)) / 1200) < 0.01 && ally.estimate, "refinance saving estimated from the rate difference");
  assert(Math.abs(ideas.find((i) => i.id === "insurance:prog")!.monthly - 27.678) < 0.01, "insurance re-quote ~10%");
}

{
  const { cashFlowHistory } = await import("../src/lib/insights.ts");
  const rows = [
    { month: "2026-09-01", flow: "income", category_id: null, bill_id: null, total: 5000, n: 2 },
    { month: "2026-09-01", flow: "spending", category_id: null, bill_id: null, total: -4200, n: 30 },
    { month: "2026-10-01", flow: "income", category_id: null, bill_id: null, total: 5000, n: 2 },
    { month: "2026-10-01", flow: "spending", category_id: null, bill_id: null, total: -5600, n: 30 },
    { month: "2026-11-01", flow: "income", category_id: null, bill_id: null, total: 100, n: 1 },
  ] as never[];
  const h = cashFlowHistory(rows, new Date("2026-11-26T12:00:00"), "2026-09-01");
  assert(h.length === 2 && h[0].month === "2026-09-01" && h[0].net === 800 && h[1].net === -600, "cash flow per past month (this month left out): " + JSON.stringify(h.map((x) => x.net)));
}
