// Refreshes home values from RentCast's automated valuation (like a
// Zestimate) for homes where "Update value automatically" is on.
//
// Lookups cost money, so they're strictly limited, and the limit is
// enforced in the database (claim_home_lookup), not just in the app:
//  * At most ONE lookup per household per calendar month, whoever asks
//    (the monthly scheduler or the app). Failed lookups count too.
//  * At most HOME_VALUE_MONTHLY_CAP lookups per month for the whole app
//    (default 40, under RentCast's free 50).
// The scheduler (x-cron-secret) runs on the 1st; the app can ask for a
// household that hasn't had its lookup yet this month.
//
// Needs the RENTCAST_API_KEY function secret. Only the home's address is
// sent to RentCast.
import { adminClient, HttpError, isCron, json, requireHousehold, serve } from "../_shared/http.ts";

const RENTCAST_URL = "https://api.rentcast.io/v1/avm/value";
const DEFAULT_MONTHLY_CAP = 40;

function monthlyCap() {
  const n = Number(Deno.env.get("HOME_VALUE_MONTHLY_CAP"));
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MONTHLY_CAP;
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};
const nextMonthName = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
};

interface Home {
  id: string;
  household_id: string;
  address: string;
  valued_at: string | null;
}

interface Valuation {
  price?: number;
  priceRangeLow?: number;
  priceRangeHigh?: number;
}

async function lookup(address: string, apiKey: string): Promise<Valuation> {
  const url = `${RENTCAST_URL}?address=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { "X-Api-Key": apiKey, Accept: "application/json" } });
  if (!res.ok) {
    // Log status only (no address) to keep personal data out of logs.
    console.error(`RentCast valuation -> ${res.status}`);
    if (res.status === 404) throw new Error("No estimate found for this address. Check the spelling.");
    if (res.status === 401 || res.status === 403) throw new Error("Home value service key is invalid.");
    if (res.status === 429) throw new Error("Home value lookups are used up for this month.");
    throw new Error("The home value service is unavailable. We'll try again next month.");
  }
  return (await res.json()) as Valuation;
}

serve(async (req) => {
  const admin = adminClient();
  // Who's calling comes first: the scheduler or a signed-in member.
  const cron = await isCron(req, admin);
  const householdId = cron ? null : (await requireHousehold(req, admin)).householdId;

  const apiKey = Deno.env.get("RENTCAST_API_KEY");
  if (!apiKey) throw new HttpError(503, "Home values aren't set up yet (missing RentCast key).");

  // Opted-in homes not yet valued this month, oldest value first.
  let query = admin
    .from("manual_assets")
    .select("id, household_id, address, valued_at")
    .eq("kind", "home")
    .eq("auto_value", true)
    .not("address", "is", null)
    .or(`valued_at.is.null,valued_at.lt.${monthStart()}`)
    .order("valued_at", { ascending: true, nullsFirst: true });

  if (!cron) {
    const body = (await req.json().catch(() => ({}))) as { assetId?: unknown };
    query = query.eq("household_id", householdId!);
    if (body.assetId !== undefined) {
      if (typeof body.assetId !== "string" || body.assetId.length > 64) throw new HttpError(400, "Invalid asset");
      query = query.eq("id", body.assetId);
    }
  }

  const { data: homes, error } = await query;
  if (error) throw error;
  if (!cron && !(homes ?? []).length) {
    return json(req, { results: [], message: "Already up to date this month." });
  }

  const cap = monthlyCap();
  const results = [];
  for (const home of (homes ?? []) as Home[]) {
    // Reserve the lookup first (atomic): this is what enforces the limits.
    const { data: claim, error: claimErr } = await admin.rpc("claim_home_lookup", {
      p_household: home.household_id,
      p_asset: home.id,
      p_global_cap: cap,
    });
    if (claimErr) throw claimErr;
    if (claim === "global_limit") {
      console.warn(`home values: monthly cap of ${cap} reached`);
      if (!cron) throw new HttpError(429, `Home values are paused until ${nextMonthName()}.`);
      break;
    }
    if (claim !== "ok") {
      if (!cron) {
        throw new HttpError(429, `Home values update once a month. The next update is ${nextMonthName()}.`);
      }
      results.push({ id: home.id, status: "limit" });
      continue;
    }
    try {
      const v = await lookup(home.address, apiKey);
      const price = Number(v.price);
      if (!Number.isFinite(price) || price <= 0) throw new Error("No estimate found for this address.");
      const now = new Date().toISOString();
      await admin.from("manual_assets").update({
        value: Math.round(price),
        value_date: now.slice(0, 10),
        value_low: Number.isFinite(Number(v.priceRangeLow)) ? Math.round(Number(v.priceRangeLow)) : null,
        value_high: Number.isFinite(Number(v.priceRangeHigh)) ? Math.round(Number(v.priceRangeHigh)) : null,
        value_source: "rentcast",
        valued_at: now,
        value_error: null,
      }).eq("id", home.id);
      results.push({ id: home.id, status: "updated", value: Math.round(price) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Lookup failed";
      await admin.from("manual_assets").update({ value_error: message }).eq("id", home.id);
      results.push({ id: home.id, status: "error", error: message });
    }
    // From the app, one lookup per request (the household's one for the month).
    if (!cron) break;
  }

  // Keep this month's net worth snapshot current.
  if (results.some((r) => r.status === "updated")) await admin.rpc("record_net_worth");
  return json(req, { results });
});
