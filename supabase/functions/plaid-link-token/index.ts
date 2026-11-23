// Creates a short-lived Plaid Link token for the signed-in user. Pass
// { itemId } to reconnect an existing bank (Link "update mode").
import {
  adminClient,
  getToken,
  json,
  requireHousehold,
  requireItem,
  serve,
} from "../_shared/sync.ts";
import { plaid } from "../_shared/plaid.ts";

serve(async (req) => {
  const admin = adminClient();
  const { user, householdId } = await requireHousehold(req, admin);
  const body = (await req.json().catch(() => ({}))) as { itemId?: unknown };

  const base = {
    client_name: "Budget",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: user.id },
  };

  let request: Record<string, unknown>;
  if (body.itemId !== undefined) {
    const item = await requireItem(admin, body.itemId, householdId);
    const token = await getToken(admin, item.id);
    request = { ...base, access_token: token };
  } else {
    request = {
      ...base,
      products: ["transactions"],
      transactions: { days_requested: 730 },
    };
  }

  const { link_token } = await plaid<{ link_token: string }>("/link/token/create", request);
  return json(req, { linkToken: link_token });
});
