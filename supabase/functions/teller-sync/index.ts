// Refreshes bank data.
//  * From the app (user JWT): syncs that user's household.
//  * From the scheduled job (header `x-cron-secret: <CRON_SECRET>`): syncs
//    every active enrollment. See README for the pg_cron schedule.
import {
  adminClient,
  corsHeaders,
  HttpError,
  json,
  requireHousehold,
  SyncResult,
  syncEnrollment,
} from "../_shared/sync.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

    let query = admin.from("teller_enrollments").select("id, household_id").neq("status", "disconnected");
    if (!isCron) {
      const { householdId } = await requireHousehold(req, admin);
      query = query.eq("household_id", householdId);
    }
    const { data: enrollments, error } = await query;
    if (error) throw error;

    const results: SyncResult[] = [];
    for (const e of enrollments ?? []) {
      results.push(await syncEnrollment(admin, e.id, e.household_id));
    }
    return json({ results });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
