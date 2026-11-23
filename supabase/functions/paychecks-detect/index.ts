// "Check deposits now": re-runs paycheck detection for the signed-in user's
// household (it also runs automatically after every bank sync).
import { adminClient, detectPaychecksForHousehold, json, requireHousehold, serve } from "../_shared/sync.ts";

serve(async (req) => {
  const admin = adminClient();
  const { householdId } = await requireHousehold(req, admin);
  const result = await detectPaychecksForHousehold(admin, householdId);
  return json(req, result);
});
