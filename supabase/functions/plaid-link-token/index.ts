// Creates a short-lived Plaid Link token for the signed-in user.
//   {}                                 connect a new bank
//   { itemId }                         reconnect a bank (Link "update mode")
//   { itemId, addDebtDetails: true }   ask an existing bank for consent to
//                                      share card/loan details (Liabilities)
import {
  adminClient,
  getToken,
  json,
  requireHousehold,
  requireItem,
  serve,
  webhookUrl,
} from "../_shared/sync.ts";
import { plaid, PlaidError } from "../_shared/plaid.ts";

async function createLinkToken(request: Record<string, unknown>, optional: Record<string, unknown>) {
  try {
    return await plaid<{ link_token: string }>("/link/token/create", { ...request, ...optional });
  } catch (e) {
    // If Plaid rejects the optional debt-details fields, still let the user
    // connect: debt details can be entered by hand.
    if (e instanceof PlaidError && e.type === "INVALID_REQUEST" && Object.keys(optional).length) {
      return await plaid<{ link_token: string }>("/link/token/create", request);
    }
    throw e;
  }
}

serve(async (req) => {
  const admin = adminClient();
  const { user, householdId } = await requireHousehold(req, admin);
  const body = (await req.json().catch(() => ({}))) as { itemId?: unknown; addDebtDetails?: unknown };

  const base = {
    client_name: "Budget",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: user.id },
  };

  let result: { link_token: string };
  if (body.itemId !== undefined) {
    const item = await requireItem(admin, body.itemId, householdId);
    const token = await getToken(admin, item.id);
    result = await createLinkToken(
      { ...base, access_token: token },
      body.addDebtDetails === true ? { additional_consented_products: ["liabilities"] } : {},
    );
  } else {
    result = await createLinkToken(
      {
        ...base,
        products: ["transactions"],
        transactions: { days_requested: 730 },
        // Plaid calls this when more history or new transactions are ready.
        webhook: webhookUrl(),
      },
      // Card APRs, minimum payments and due dates, when the bank supports it.
      { optional_products: ["liabilities"] },
    );
  }
  return json(req, { linkToken: result.link_token });
});
