// Called by the app right after Teller Connect succeeds. Verifies the token
// with Teller, stores it encrypted in Vault (the app never keeps it) and runs
// the first sync.
import {
  adminClient,
  HttpError,
  json,
  requireHousehold,
  serve,
  syncEnrollment,
} from "../_shared/sync.ts";
import { TellerAccount, TellerError, tellerGet } from "../_shared/teller.ts";

interface EnrollBody {
  accessToken?: unknown;
  enrollment?: { id?: unknown; institution?: { name?: unknown } };
}

serve(async (req) => {
  const admin = adminClient();
  const { user, householdId } = await requireHousehold(req, admin);

  const body = (await req.json().catch(() => ({}))) as EnrollBody;
  const accessToken = body.accessToken;
  const enrollmentId = body.enrollment?.id;
  if (typeof accessToken !== "string" || typeof enrollmentId !== "string" ||
      accessToken.length > 200 || enrollmentId.length > 100) {
    throw new HttpError(400, "Invalid bank connection details");
  }
  const institution = typeof body.enrollment?.institution?.name === "string"
    ? body.enrollment.institution.name.slice(0, 100)
    : null;

  // Prove the token is real and belongs to the enrollment it claims to be.
  let accounts: TellerAccount[];
  try {
    accounts = await tellerGet<TellerAccount[]>("/accounts", accessToken);
  } catch (e) {
    if (e instanceof TellerError && e.status < 500) {
      throw new HttpError(400, "Teller didn't accept this bank connection. Please try again.");
    }
    throw e;
  }
  if (!accounts.every((a) => a.enrollment_id === enrollmentId)) {
    throw new HttpError(400, "Bank connection details don't match. Please try again.");
  }

  const { data: existing } = await admin
    .from("teller_enrollments")
    .select("household_id")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (existing && existing.household_id !== householdId) {
    throw new HttpError(403, "This bank connection belongs to another household");
  }

  const { error: enrollErr } = await admin.from("teller_enrollments").upsert({
    id: enrollmentId,
    household_id: householdId,
    institution_name: institution ?? accounts[0]?.institution?.name ?? null,
    status: "active",
    last_error: null,
    created_by: user.id,
  });
  if (enrollErr) throw enrollErr;

  // Reconnecting the same bank returns a fresh token for the same enrollment.
  const { error: tokenErr } = await admin.rpc("store_teller_token", {
    p_enrollment_id: enrollmentId,
    p_token: accessToken,
  });
  if (tokenErr) throw tokenErr;

  const result = await syncEnrollment(admin, enrollmentId, householdId);
  return json(req, { status: result.status, accounts: result.accounts, transactions: result.transactions });
});
