import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  LiabilitiesResponse,
  plaid,
  PlaidAccount,
  PlaidError,
  PlaidTransaction,
  TransactionsSyncResponse,
} from "./plaid.ts";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// Browsers may only call these functions from the app's own website. The
// iPhone app sends no Origin header, so CORS doesn't apply to it. Add your
// hosted domain to the ALLOWED_ORIGINS secret (comma separated) when you
// publish the website.
const DEFAULT_ORIGINS = ["http://localhost:8081", "http://127.0.0.1:8081"];

function allowedOrigins() {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && allowedOrigins().has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Runs a handler with CORS preflight and safe error responses. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
      // Log details for us; show users a generic message.
      console.error(e instanceof PlaidError ? `PlaidError ${e.code}` : e);
      return json(req, { error: "Something went wrong. Please try again." }, 500);
    }
  });
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

/** Service-role client: bypasses RLS. Only ever used server-side. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/** Resolves the signed-in user and their household from the request. */
export async function requireHousehold(req: Request, admin: SupabaseClient) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Not signed in");
  const { data: { user }, error } = await admin.auth.getUser(jwt);
  if (error || !user) throw new HttpError(401, "Not signed in");

  const { data: member } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) throw new HttpError(400, "Create or join a household first");
  return { user, householdId: member.household_id as string };
}

/** Loads a bank item, making sure it belongs to the caller's household. */
export async function requireItem(admin: SupabaseClient, itemId: unknown, householdId: string) {
  if (typeof itemId !== "string" || itemId.length > 100) {
    throw new HttpError(400, "Invalid bank connection");
  }
  const { data: item } = await admin
    .from("bank_items")
    .select("id, household_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || item.household_id !== householdId) {
    throw new HttpError(404, "Bank connection not found");
  }
  return item as { id: string; household_id: string };
}

/** Decrypts an item's Plaid access token from Vault (service role only). */
export async function getToken(admin: SupabaseClient, itemId: string) {
  const { data, error } = await admin.rpc("get_item_token", { p_item_id: itemId });
  if (error) throw error;
  return (data as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncResult {
  itemId: string;
  status: "active" | "disconnected" | "error";
  added: number;
}

/** Pages through /transactions/sync from a cursor; restarts if data shifts. */
async function fetchChanges(token: string, startCursor: string | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let cursor = startCursor;
      const added: PlaidTransaction[] = [];
      const modified: PlaidTransaction[] = [];
      const removed: string[] = [];
      let hasMore = true;
      while (hasMore) {
        const page = await plaid<TransactionsSyncResponse>("/transactions/sync", {
          access_token: token,
          ...(cursor ? { cursor } : {}),
          count: 500,
        });
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed.map((r) => r.transaction_id));
        cursor = page.next_cursor;
        hasMore = page.has_more;
      }
      return { added, modified, removed, cursor };
    } catch (e) {
      if (e instanceof PlaidError && e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") {
        continue;
      }
      throw e;
    }
  }
  throw new Error("Transactions kept changing during sync");
}

/**
 * Saves APR, minimum payment and due date for cards and loans (Plaid
 * Liabilities). Optional: if the bank or Plaid plan doesn't support it, the
 * sync carries on and those details can be entered by hand.
 */
async function syncLiabilities(admin: SupabaseClient, token: string, householdId: string) {
  let data: LiabilitiesResponse;
  try {
    data = await plaid<LiabilitiesResponse>("/liabilities/get", { access_token: token });
  } catch (e) {
    console.warn("liabilities unavailable:", e instanceof PlaidError ? e.code : e);
    return;
  }
  const l = data.liabilities ?? {};
  const now = new Date().toISOString();
  const rows = [
    ...(l.credit ?? []).map((c) => ({
      account_id: c.account_id,
      apr: (c.aprs?.find((a) => a.apr_type === "purchase_apr") ?? c.aprs?.[0])?.apr_percentage ?? null,
      minimum_payment: c.minimum_payment_amount ?? null,
      next_due_date: c.next_payment_due_date ?? null,
      last_statement_balance: c.last_statement_balance ?? null,
    })),
    ...(l.student ?? []).map((s) => ({
      account_id: s.account_id,
      apr: s.interest_rate_percentage ?? null,
      minimum_payment: s.minimum_payment_amount ?? null,
      next_due_date: s.next_payment_due_date ?? null,
      last_statement_balance: s.last_statement_balance ?? null,
    })),
    ...(l.mortgage ?? []).map((m) => ({
      account_id: m.account_id,
      apr: m.interest_rate?.percentage ?? null,
      minimum_payment: m.next_monthly_payment ?? null,
      next_due_date: m.next_payment_due_date ?? null,
      last_statement_balance: null,
    })),
  ]
    .filter((r): r is typeof r & { account_id: string } => !!r.account_id)
    .map((r) => ({ ...r, household_id: householdId, updated_at: now }));
  if (!rows.length) return;
  const { error } = await admin.from("account_liabilities").upsert(rows, { onConflict: "account_id" });
  if (error) console.error("saving liabilities failed:", error.message);
}

/**
 * Refreshes balances and pulls new/changed/removed transactions with Plaid's
 * /transactions/sync, resuming from the cursor saved on the item.
 */
export async function syncItem(
  admin: SupabaseClient,
  itemId: string,
  householdId: string,
): Promise<SyncResult> {
  const token = await getToken(admin, itemId);
  if (!token) return { itemId, status: "error", added: 0 };

  try {
    const { data: item } = await admin
      .from("bank_items")
      .select("institution_name, sync_cursor")
      .eq("id", itemId)
      .single();

    // Balances: /accounts/get returns Plaid's cached balances (no extra fee).
    const { accounts } = await plaid<{ accounts: PlaidAccount[] }>("/accounts/get", {
      access_token: token,
    });
    if (accounts.length) {
      const { error } = await admin.from("accounts").upsert(
        accounts.map((a) => ({
          id: a.account_id,
          household_id: householdId,
          item_id: itemId,
          name: a.name,
          institution_name: item?.institution_name ?? null,
          type: a.type,
          subtype: a.subtype,
          last_four: a.mask,
          currency: a.balances.iso_currency_code ?? "USD",
          status: "open",
          balance_available: a.balances.available,
          balance_ledger: a.balances.current,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "id" },
      );
      if (error) throw error;
    }

    if (accounts.some((a) => a.type === "credit" || a.type === "loan")) {
      await syncLiabilities(admin, token, householdId);
    }

    const changes = await fetchChanges(token, item?.sync_cursor ?? null);

    // Only keep transactions for accounts the user shared with the app.
    const known = new Set(accounts.map((a) => a.account_id));
    const now = new Date().toISOString();
    const rows = [...changes.added, ...changes.modified]
      .filter((t) => known.has(t.account_id))
      .map((t) => ({
        id: t.transaction_id,
        household_id: householdId,
        account_id: t.account_id,
        date: t.date,
        description: t.name,
        merchant: t.merchant_name ?? null,
        // Plaid: positive = money out. This app: negative = money out.
        amount: -t.amount,
        status: t.pending ? "pending" : "posted",
        category_primary: t.personal_finance_category?.primary ?? null,
        category_detailed: t.personal_finance_category?.detailed ?? null,
        updated_at: now,
      }));
    // Upsert only Plaid-owned columns, so categories/notes you set are kept.
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("transactions").upsert(rows.slice(i, i + 500), {
        onConflict: "id",
      });
      if (error) throw error;
    }
    for (let i = 0; i < changes.removed.length; i += 500) {
      const { error } = await admin
        .from("transactions")
        .delete()
        .eq("household_id", householdId)
        .in("id", changes.removed.slice(i, i + 500));
      if (error) throw error;
    }

    await admin.from("bank_items").update({
      status: "active",
      last_error: null,
      sync_cursor: changes.cursor,
      last_synced_at: now,
    }).eq("id", itemId);

    return { itemId, status: "active", added: changes.added.length };
  } catch (e) {
    const disconnected = e instanceof PlaidError && e.needsReconnect;
    console.error(`sync ${itemId} failed:`, e instanceof PlaidError ? e.code : e);
    // Store a user-facing message only; details stay in the function logs.
    const message = disconnected
      ? "The bank needs you to sign in again."
      : e instanceof PlaidError && e.code === "PRODUCT_NOT_READY"
      ? "The bank is still preparing your transactions. Try again in a few minutes."
      : e instanceof PlaidError
      ? "The bank connection is temporarily unavailable."
      : "Sync failed. We'll retry on the next sync.";
    await admin.from("bank_items").update({
      status: disconnected ? "disconnected" : "error",
      last_error: message,
    }).eq("id", itemId);
    return { itemId, status: disconnected ? "disconnected" : "error", added: 0 };
  }
}
