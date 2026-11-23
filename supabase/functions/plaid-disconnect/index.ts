// Removes a bank: revokes this app's access at Plaid first (/item/remove),
// then deletes the item, its accounts and transactions, and wipes the token.
import {
  adminClient,
  getToken,
  HttpError,
  json,
  requireHousehold,
  requireItem,
  serve,
} from "../_shared/sync.ts";
import { plaid, PlaidError } from "../_shared/plaid.ts";

serve(async (req) => {
  const admin = adminClient();
  const { householdId } = await requireHousehold(req, admin);
  const body = (await req.json().catch(() => ({}))) as { itemId?: unknown };
  const item = await requireItem(admin, body.itemId, householdId);

  const token = await getToken(admin, item.id);
  if (token) {
    try {
      await plaid("/item/remove", { access_token: token });
    } catch (e) {
      // Already gone at Plaid: safe to delete locally.
      const gone = e instanceof PlaidError &&
        ["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"].includes(e.code);
      if (!gone) throw new HttpError(502, "Couldn't reach Plaid to revoke access. Please try again.");
    }
  }

  const { error } = await admin.from("bank_items").delete().eq("id", item.id);
  if (error) throw error;
  return json(req, { removed: true });
});
