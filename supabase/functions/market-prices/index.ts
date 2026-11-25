// Saves daily S&P 500 closes (public data), so accounts you can't connect,
// like a 401k in an S&P 500 fund, can follow the index in net worth.
//
// Source: the Federal Reserve's FRED series SP500 (no key needed); Stooq's
// ^SPX history as a fallback. Runs daily from the scheduler; a signed-in
// user can also trigger it (e.g. right after adding an account).
// It's public market data: nothing about you is sent anywhere.
import { adminClient, isCron, json, requireHousehold, serve } from "../_shared/http.ts";

const FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500";
const STOOQ = "https://stooq.com/q/d/l/?s=%5Espx&i=d";
const KEEP_DAYS = 5 * 366;

type Row = { date: string; close: number };

/** Parses "date,value" CSV rows (FRED: missing days are "."). */
function parse(csv: string, closeColumn: (header: string[]) => number): Row[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines.shift() ?? "").split(",").map((h) => h.trim().toLowerCase());
  const col = closeColumn(header);
  const out: Row[] = [];
  for (const line of lines) {
    const cells = line.split(",");
    const date = cells[0]?.trim();
    const close = Number(cells[col]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0) out.push({ date, close });
  }
  return out;
}

async function download(url: string) {
  const res = await fetch(url, { headers: { Accept: "text/csv", "User-Agent": "budget-app/1.0" } });
  if (!res.ok) throw new Error(`${new URL(url).host} -> ${res.status}`);
  return await res.text();
}

async function fetchCloses(): Promise<{ rows: Row[]; source: string }> {
  try {
    const rows = parse(await download(FRED), () => 1);
    if (rows.length > 100) return { rows, source: "fred" };
    throw new Error("FRED returned too little data");
  } catch (e) {
    console.warn("FRED failed, trying Stooq:", e instanceof Error ? e.message : e);
    const rows = parse(await download(STOOQ), (h) => Math.max(1, h.indexOf("close")));
    return { rows, source: "stooq" };
  }
}

serve(async (req) => {
  const admin = adminClient();
  const cron = await isCron(req, admin);
  if (!cron) {
    await requireHousehold(req, admin); // signed in
    // From the app: only download if the newest close is over 3 days old
    // (covers weekends), so repeated taps don't hit the data source.
    const { data: newest } = await admin
      .from("market_prices").select("date").eq("symbol", "SP500").order("date", { ascending: false }).limit(1);
    const last = newest?.[0]?.date as string | undefined;
    if (last && Date.now() - Date.parse(last) < 3 * 86_400_000) return json(req, { saved: 0, latest: { date: last } });
  }

  const { rows, source } = await fetchCloses();
  const since = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const recent = rows.filter((r) => r.date >= since).map((r) => ({ symbol: "SP500", ...r }));
  for (let i = 0; i < recent.length; i += 500) {
    const { error } = await admin.from("market_prices").upsert(recent.slice(i, i + 500), { onConflict: "symbol,date" });
    if (error) throw error;
  }
  const latest = recent.at(-1);
  // Keep today's net worth snapshot current.
  await admin.rpc("record_net_worth").then(() => {}, () => {});
  return json(req, { source, saved: recent.length, latest });
});
