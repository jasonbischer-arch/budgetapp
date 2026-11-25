import { detectPaychecks, payerKey, type Deposit } from "../supabase/functions/_shared/paychecks.ts";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); };
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDays = (s: string, n: number) => new Date(Date.parse(s + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dow = (s: string) => new Date(s + "T00:00:00Z").getUTCDay();
const today = "2026-11-23";

const deposits: Deposit[] = [];

// 1. Every other Friday, $2,000 +/- a little, plus one $3,500 bonus check.
for (let d = "2026-05-15"; d <= "2026-11-13"; d = addDays(d, 14)) {
  deposits.push({ date: d, amount: d === "2026-09-04" ? 3500 : 2000 + (d.charCodeAt(9) % 3) * 10, description: "ACME CORP DIRECT DEP PPD ID: 9876543", merchant: null, category_detailed: "INCOME_WAGES" });
}

// 2. Twice a month on the 7th and 22nd; paid the Friday before when that's a weekend.
for (let m = 5; m <= 11; m++) {
  for (const day of [7, 22]) {
    let d = iso(2026, m, day);
    if (dow(d) === 6) d = addDays(d, -1);
    if (dow(d) === 0) d = addDays(d, -2);
    if (d <= today) deposits.push({ date: d, amount: 1600, description: "GUSTO PAY 123456 HOSPITAL INC", merchant: null, category_detailed: "INCOME_WAGES" });
  }
}

// 3. Same payroll company, different person (much smaller checks), monthly on the 1st.
for (let m = 6; m <= 11; m++) deposits.push({ date: iso(2026, m, 1), amount: 450, description: "GUSTO PAY 778899 HOSPITAL INC", merchant: null });

// 4. An old job that stopped in July.
for (let d = "2026-03-06"; d <= "2026-07-10"; d = addDays(d, 14)) deposits.push({ date: d, amount: 1200, description: "OLDJOB LLC PAYROLL", merchant: null });

// 5. Noise: Venmo transfers, a tax refund.
deposits.push({ date: "2026-08-03", amount: 250, description: "VENMO CASHOUT", merchant: "Venmo" });
deposits.push({ date: "2026-09-20", amount: 300, description: "VENMO CASHOUT", merchant: "Venmo" });
deposits.push({ date: "2026-04-15", amount: 1800, description: "IRS TREAS 310 TAX REF", merchant: null });

const found = detectPaychecks(deposits, today);
for (const f of found) console.log("  ", JSON.stringify(f));

assert(payerKey({ description: "ACME CORP DIRECT DEP PPD ID: 9876543", merchant: null }) === "ACME", "strips bank filler from payer names");

const acme = found.find((f) => f.key === "ACME");
assert(acme?.frequency === "biweekly" && acme.anchor_date === "2026-11-13", "every-other-Friday paycheck, last paid Nov 13");
assert(acme && Math.abs(acme.average - 2010) < 15, "average ignores the one-off bonus: " + acme?.average);
assert(acme?.active === true, "Acme is still active");

const gusto = found.filter((f) => f.key.startsWith("GUSTO PAY HOSPITAL"));
assert(gusto.length === 2, "same payroll company, two people -> two paychecks");
const wife = gusto.find((g) => g.frequency === "semimonthly");
assert(wife?.day1 === 7 && wife?.day2 === 22, "twice monthly on the 7th and 22nd (despite weekend shifts)");
assert(wife?.weekend_shift === "before", "learns weekend paydays arrive the Friday before");
assert(wife?.average === 1600, "twice-monthly average $1,600");
const small = gusto.find((g) => g.frequency === "monthly");
assert(small?.day1 === 1 && small.average === 450, "monthly $450 on the 1st");

const old = found.find((f) => f.key.startsWith("OLDJOB"));
assert(old && old.active === false, "stopped paycheck marked inactive");
assert(!found.some((f) => f.key.includes("VENMO") || f.key.includes("IRS")), "ignores transfers and one-off refunds");

// Last-day-of-month payroll (28-31).
const eom: Deposit[] = ["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-30", "2026-11-13", "2026-10-15", "2026-09-15", "2026-08-14", "2026-07-15", "2026-06-15"]
  .map((date) => ({ date, amount: 2500, description: "STATE OF CA PAYROLL", merchant: null }));
const ca = detectPaychecks(eom, today)[0];
assert(ca.frequency === "semimonthly" && ca.day1 === 15 && ca.day2 === 31, "15th and last day of the month: " + JSON.stringify([ca.day1, ca.day2]));

// --- Same payer, same day = one paycheck (base pay + commission deposits) ----
{
  const { detectPaychecks: detect } = await import("../supabase/functions/_shared/paychecks.ts");
  const fridays = ["2026-07-10","2026-07-24","2026-08-07","2026-08-21","2026-09-04","2026-09-18","2026-10-02","2026-10-16","2026-10-30","2026-11-13"];
  const extra: Record<string, number> = { "2026-07-24": 1251.06, "2026-08-21": 1159.33, "2026-09-04": 1997.26, "2026-09-18": 1168.58, "2026-10-02": 1337.84, "2026-10-30": 1050.94 };
  const deposits = fridays.flatMap((d) => [
    { date: d, amount: 2843.37, description: "BLUELINX CORPORA PAYROLL", merchant: null },
    ...(extra[d] ? [{ date: d, amount: extra[d], description: "BLUELINX CORPORA PAYROLL", merchant: null }] : []),
  ]);
  const found = detect(deposits, "2026-11-25");
  if (found.length !== 1) throw new Error("FAIL: one paycheck, not a separate 'monthly' one: " + JSON.stringify(found.map((f) => [f.name, f.frequency, f.day1])));
  const p = found[0];
  if (p.frequency !== "biweekly" || p.anchor_date !== "2026-11-13") throw new Error("FAIL: every other Friday from Nov 13: " + p.frequency + " " + p.anchor_date);
  if (Math.abs(p.low - 2843.37) > 0.01) throw new Error("FAIL: budgets with the dependable base pay: " + p.low);
  if (!(p.average > p.low)) throw new Error("FAIL: average still reflects commission");
  console.log("ok - two same-day deposits from one payer = one biweekly Friday paycheck; budget amount = base pay");
}
