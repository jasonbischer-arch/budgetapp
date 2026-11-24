// "Check bank activity now": re-runs paycheck and bill detection for the
// signed-in user's household (both also run automatically after every sync).
import {
  adminClient,
  detectBillsForHousehold,
  detectPaychecksForHousehold,
  json,
  requireHousehold,
  serve,
} from "../_shared/sync.ts";

serve(async (req) => {
  const admin = adminClient();
  const { householdId } = await requireHousehold(req, admin);
  const paychecks = await detectPaychecksForHousehold(admin, householdId);
  const bills = await detectBillsForHousehold(admin, householdId);
  // Top-level fields kept for older app versions (paychecks).
  return json(req, { ...paychecks, paychecks, bills });
});
