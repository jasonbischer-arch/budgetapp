// Refreshes bank data.
//  * From the app (user JWT): syncs that user's household, at most once a
//    minute.
//  * From the scheduled job (header `x-cron-secret`): syncs every active
//    enrollment. The secret is generated in the database and kept in Vault.
import {
  adminClient,
  HttpError,
  json,
  requireHousehold,
  safeEqual,
  serve,
  syncEnrollment,
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

  let query = admin
    .from("teller_enrollments")
    .select("id, household_id")
    .neq("status", "disconnected");

  if (!isCron) {
    const { householdId } = await requireHousehold(req, admin);
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
    query = query.eq("household_id", householdId);
  }

  const { data: enrollments, error } = await query;
  if (error) throw error;

  const results = [];
  for (const e of enrollments ?? []) {
    const r = await syncEnrollment(admin, e.id, e.household_id);
    results.push({ enrollmentId: r.enrollmentId, status: r.status, transactions: r.transactions });
  }
  return json(req, { results });
});
