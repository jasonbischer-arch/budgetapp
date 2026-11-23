// Called after Plaid Link succeeds. Exchanges the one-time public token for an
// access token server-side, stores it encrypted in Vault (the app never sees
// it), and runs the first sync.
import {
  adminClient,
  HttpError,
  json,
  requireHousehold,
  serve,
  syncItem,
} from "../_shared/sync.ts";
import { plaid, PlaidError } from "../_shared/plaid.ts";

interface ExchangeBody {
  publicToken?: unknown;
  institution?: { id?: unknown; name?: unknown } | null;
}

serve(async (req) => {
  const admin = adminClient();
  const { user, householdId } = await requireHousehold(req, admin);

  const body = (await req.json().catch(() => ({}))) as ExchangeBody;
  if (typeof body.publicToken !== "string" || body.publicToken.length > 200) {
    throw new HttpError(400, "Invalid bank connection details");
  }
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : null);
  const institutionName = str(body.institution?.name);
  const institutionId = str(body.institution?.id);

  // The exchange only succeeds for public tokens issued to this Plaid app,
  // so it also proves the connection is genuine.
  let exchanged: { access_token: string; item_id: string };
  try {
    exchanged = await plaid("/item/public_token/exchange", { public_token: body.publicToken });
  } catch (e) {
    if (e instanceof PlaidError && e.status < 500) {
      throw new HttpError(400, "Plaid didn't accept this bank connection. Please try again.");
    }
    throw e;
  }

  const { data: existing } = await admin
    .from("bank_items")
    .select("household_id")
    .eq("id", exchanged.item_id)
    .maybeSingle();
  if (existing && existing.household_id !== householdId) {
    throw new HttpError(403, "This bank connection belongs to another household");
  }

  const { error: itemErr } = await admin.from("bank_items").upsert({
    id: exchanged.item_id,
    household_id: householdId,
    institution_name: institutionName,
    institution_id: institutionId,
    status: "active",
    last_error: null,
    created_by: user.id,
  });
  if (itemErr) throw itemErr;

  const { error: tokenErr } = await admin.rpc("store_item_token", {
    p_item_id: exchanged.item_id,
    p_token: exchanged.access_token,
  });
  if (tokenErr) throw tokenErr;

  const result = await syncItem(admin, exchanged.item_id, householdId);
  return json(req, { itemId: exchanged.item_id, status: result.status, added: result.added });
});
