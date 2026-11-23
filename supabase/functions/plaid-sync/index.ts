// Refreshes bank data.
//  * From the app (user JWT): syncs that user's household, at most once a
//    minute. Pass { itemId } after a reconnect to sync just that bank.
//  * From the scheduled job (header `x-cron-secret`): syncs every connected
//    bank. The secret is generated in the database and kept in Vault.
import {
  adminClient,
  HttpError,
  json,
  requireHousehold,
  requireItem,
  safeEqual,
  serve,
  syncItem,
} from "../_shared/sync.ts";

const MANUAL_SYNC_COOLDOWN_MS = 60_000;

serve(async (req) => {
  const admin = adminClient();

  const provided = req.headers.get("x-cron-secret");
  let isCron = false;
  if (provided) {
    const { data: expected, error } = await admin.rpc("get_cron_secret");
    if (error) throw error;
    if (!expected || !safeEqual(provided, expected as string)) throw new HttpError(401, "Unauthorized");
    isCron = true;
  }

  let items: { id: string; household_id: string }[];
  if (isCron) {
    const { data, error } = await admin
      .from("bank_items")
      .select("id, household_id")
      .neq("status", "disconnected");
    if (error) throw error;
    items = data ?? [];
  } else {
    const { householdId } = await requireHousehold(req, admin);
    const body = (await req.json().catch(() => ({}))) as { itemId?: unknown };

    if (body.itemId !== undefined) {
      // Right after reconnecting a bank: sync it once, no cooldown.
      items = [await requireItem(admin, body.itemId, householdId)];
    } else {
      const { data: household } = await admin
        .from("households")
        .select("last_manual_sync_at")
        .eq("id", householdId)
        .single();
      const last = household?.last_manual_sync_at ? Date.parse(household.last_manual_sync_at) : 0;
      if (Date.now() - last < MANUAL_SYNC_COOLDOWN_MS) {
        throw new HttpError(429, "Synced moments ago. Try again in a minute.");
      }
      await admin
        .from("households")
        .update({ last_manual_sync_at: new Date().toISOString() })
        .eq("id", householdId);
      const { data, error } = await admin
        .from("bank_items")
        .select("id, household_id")
        .eq("household_id", householdId);
      if (error) throw error;
      items = data ?? [];
    }
  }

  const results = [];
  for (const item of items) results.push(await syncItem(admin, item.id, item.household_id));
  return json(req, { results });
});
