// Removes a bank: revokes this app's access at Teller first, then deletes the
// enrollment, its accounts and transactions, and the encrypted token.
import {
  adminClient,
  getToken,
  HttpError,
  json,
  requireHousehold,
  serve,
} from "../_shared/sync.ts";
import { TellerError, tellerRevoke } from "../_shared/teller.ts";

serve(async (req) => {
  const admin = adminClient();
  const { householdId } = await requireHousehold(req, admin);

  const body = (await req.json().catch(() => ({}))) as { enrollmentId?: unknown };
  if (typeof body.enrollmentId !== "string") throw new HttpError(400, "enrollmentId is required");

  const { data: enrollment } = await admin
    .from("teller_enrollments")
    .select("id, household_id")
    .eq("id", body.enrollmentId)
    .maybeSingle();
  if (!enrollment || enrollment.household_id !== householdId) {
    throw new HttpError(404, "Bank connection not found");
  }

  const token = await getToken(admin, enrollment.id);
  if (token) {
    try {
      await tellerRevoke(token);
    } catch (e) {
      // Already revoked or expired at Teller: safe to delete locally.
      if (!(e instanceof TellerError && e.needsReconnect)) {
        throw new HttpError(502, "Couldn't reach Teller to revoke access. Please try again.");
      }
    }
  }

  const { error } = await admin.from("teller_enrollments").delete().eq("id", enrollment.id);
  if (error) throw error;
  return json(req, { removed: true });
});
