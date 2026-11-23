// Refreshes home values from RentCast's automated valuation (like a
// Zestimate) for homes where "Update value automatically" is on.
//  * Scheduler (x-cron-secret), monthly: every opted-in home not valued in
//    the last 25 days.
//  * App (signed in): this household's opted-in homes, or { assetId } for one,
//    at most once a day per home (protects the monthly lookup allowance).
//
// Needs the RENTCAST_API_KEY function secret. Only the home's address is
// sent to RentCast.
import { adminClient, HttpError, isCron, json, requireHousehold, serve } from "../_shared/http.ts";

const RENTCAST_URL = "https://api.rentcast.io/v1/avm/value";
const CRON_MIN_AGE_DAYS = 25;
const MANUAL_MIN_AGE_HOURS = 24;

interface Home {
  id: string;
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

  let query = admin
    .from("manual_assets")
    .select("id, address, valued_at")
    .eq("kind", "home")
    .eq("auto_value", true)
    .not("address", "is", null);

  if (cron) {
    const cutoff = new Date(Date.now() - CRON_MIN_AGE_DAYS * 86_400_000).toISOString();
    query = query.or(`valued_at.is.null,valued_at.lt.${cutoff}`);
  } else {
    const body = (await req.json().catch(() => ({}))) as { assetId?: unknown };
    query = query.eq("household_id", householdId!);
    if (body.assetId !== undefined) {
      if (typeof body.assetId !== "string") throw new HttpError(400, "Invalid asset");
      query = query.eq("id", body.assetId);
    }
  }

  const { data: homes, error } = await query;
  if (error) throw error;

  const results = [];
  for (const home of (homes ?? []) as Home[]) {
    if (!cron && home.valued_at &&
        Date.now() - Date.parse(home.valued_at) < MANUAL_MIN_AGE_HOURS * 3_600_000) {
      results.push({ id: home.id, status: "recent" });
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
  }

  // Keep this month's net worth snapshot current.
  if (results.some((r) => r.status === "updated")) await admin.rpc("record_net_worth");
  return json(req, { results });
});
