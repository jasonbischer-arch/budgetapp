// Called by the app right after Teller Connect succeeds. Stores the access
// token server-side (the app never keeps it) and runs the first sync.
import {
  adminClient,
  corsHeaders,
  HttpError,
  json,
  requireHousehold,
  syncEnrollment,
} from "../_shared/sync.ts";

interface EnrollBody {
  accessToken: string;
  enrollment: { id: string; institution?: { name?: string } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();
    const { user, householdId } = await requireHousehold(req, admin);
    const body = (await req.json()) as EnrollBody;
    if (!body?.accessToken || !body?.enrollment?.id) {
      throw new HttpError(400, "accessToken and enrollment.id are required");
    }

    const { data: existing } = await admin
      .from("teller_enrollments")
      .select("household_id")
      .eq("id", body.enrollment.id)
      .maybeSingle();
    if (existing && existing.household_id !== householdId) {
      throw new HttpError(403, "This bank connection belongs to another household");
    }

    const { error: enrollErr } = await admin.from("teller_enrollments").upsert({
      id: body.enrollment.id,
      household_id: householdId,
      institution_name: body.enrollment.institution?.name ?? null,
      status: "active",
      last_error: null,
      created_by: user.id,
    });
    if (enrollErr) throw enrollErr;

    // Reconnecting the same bank returns a fresh token for the same enrollment.
    const { error: tokenErr } = await admin.from("teller_tokens").upsert({
      enrollment_id: body.enrollment.id,
      access_token: body.accessToken,
    });
    if (tokenErr) throw tokenErr;

    const result = await syncEnrollment(admin, body.enrollment.id, householdId);
    return json(result);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
