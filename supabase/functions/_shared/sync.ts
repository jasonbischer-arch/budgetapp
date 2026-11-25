import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  LiabilitiesResponse,
  plaid,
  PlaidAccount,
  PlaidError,
  PlaidTransaction,
  TransactionsSyncResponse,
} from "./plaid.ts";
import { daysAgo, detectPaychecks } from "./paychecks.ts";
import { detectBills, matchLoanAccount } from "./bills-detect.ts";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// Any website may *send* requests, because that isn't what protects data:
// every function requires the user's sign-in token (sent as a header, never
// a cookie), so another site can't act as a signed-in user. This matches
// Supabase's recommended setup and works on every Vercel preview address.
export function corsHeaders(_req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
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

/** Where Plaid sends webhooks for this project. */
export function webhookUrl() {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/plaid-webhook`;
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
      .select("institution_name, sync_cursor, webhook_registered")
      .eq("id", itemId)
      .single();

    // Banks connected before webhooks existed: tell Plaid where to send them.
    if (item && !item.webhook_registered) {
      try {
        await plaid("/item/webhook/update", { access_token: token, webhook: webhookUrl() });
        await admin.from("bank_items").update({ webhook_registered: true }).eq("id", itemId);
      } catch (e) {
        console.warn("webhook registration failed:", e instanceof PlaidError ? e.code : e);
      }
    }

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
        // Lets the totals ignore a pending copy once the posted one arrives.
        pending_transaction_id: t.pending_transaction_id ?? null,
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

// ---------------------------------------------------------------------------
// Paycheck detection
// ---------------------------------------------------------------------------

/**
 * Looks for regular paychecks in the last ~7 months of deposits and keeps the
 * household's income sources in step:
 *  - new active paycheck          -> added (auto)
 *  - auto source                  -> amount and schedule follow the bank
 *  - source you edited            -> only the stats (average, last paid) refresh
 *  - source you deleted           -> left alone
 */
export async function detectPaychecksForHousehold(admin: SupabaseClient, householdId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: deposits, error } = await admin
    .from("transaction_flows")
    .select("date, amount, description, merchant, category_detailed")
    .eq("household_id", householdId)
    .eq("flow", "income")
    .gte("date", daysAgo(today, 210));
  if (error) throw error;

  const found = detectPaychecks(
    (deposits ?? []).map((d) => ({ ...d, amount: Number(d.amount) })),
    today,
  );

  const { data: existing } = await admin
    .from("income_sources")
    .select("id, auto, dismissed, detection_key")
    .eq("household_id", householdId)
    .not("detection_key", "is", null);

  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  for (const p of found) {
    let match = (existing ?? []).find((e) => e.detection_key === p.key);
    // It used to be split ("#1", "#2") and you edited one: that one becomes
    // this paycheck, keeping your changes, instead of adding a duplicate.
    const adopt = !match && !/#\d+$/.test(p.key)
      ? (existing ?? []).find((e) => !e.auto && !e.dismissed && (e.detection_key ?? "").replace(/#\d+$/, "") === p.key)
      : undefined;
    if (adopt) {
      await admin.from("income_sources").update({ detection_key: p.key }).eq("id", adopt.id);
      adopt.detection_key = p.key;
      match = adopt;
    }
    const stats = {
      average_amount: p.average,
      last_amount: p.last_amount,
      last_paid: p.last_paid,
      occurrences: p.occurrences,
      detected_at: now,
    };
    const schedule = {
      // Budget with the dependable part of the check (pay that varies with
      // commission uses its low end; your commission estimate covers the rest).
      amount: p.low,
      frequency: p.frequency,
      anchor_date: p.anchor_date,
      day1: p.day1,
      day2: p.day2,
      weekend_shift: p.weekend_shift,
    };
    if (!match) {
      if (!p.active) continue; // don't add a job that has stopped paying
      const { error: e } = await admin.from("income_sources").insert({
        household_id: householdId,
        name: p.name,
        auto: true,
        detection_key: p.key,
        ...schedule,
        ...stats,
      });
      if (e) console.error("adding detected paycheck failed:", e.message);
      else added++;
    } else if (!match.dismissed) {
      const { error: e } = await admin
        .from("income_sources")
        .update(match.auto ? { ...schedule, ...stats } : stats)
        .eq("id", match.id);
      if (e) console.error("updating detected paycheck failed:", e.message);
      else updated++;
    }
  }
  // An employer that used to show as two paychecks (e.g. "#1" base pay and
  // "#2" commission) is now one: retire the old automatic split ones.
  const foundKeys = new Set(found.map((p) => p.key));
  const retire = (existing ?? []).filter(
    (e) => e.auto && !e.dismissed && /#\d+$/.test(e.detection_key ?? "") &&
      foundKeys.has((e.detection_key ?? "").replace(/#\d+$/, "")),
  );
  if (retire.length) {
    await admin.from("income_sources").update({ dismissed: true }).in("id", retire.map((e) => e.id));
  }
  return { found: found.length, added, updated };
}

// ---------------------------------------------------------------------------
// Bill / monthly payment detection
// ---------------------------------------------------------------------------

/**
 * Finds regular monthly payments out of checking and keeps the household's
 * bills in step (same rules as paychecks: auto ones follow the bank, edited
 * ones keep your changes, deleted ones stay hidden). Also tracks every
 * connected loan and credit card as a debt.
 */
export async function detectBillsForHousehold(admin: SupabaseClient, householdId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: accounts, error: aErr } = await admin
    .from("accounts")
    .select("id, name, institution_name, type, subtype, hidden")
    .eq("household_id", householdId);
  if (aErr) throw aErr;
  const checking = (accounts ?? []).filter((a) => a.type === "depository").map((a) => a.id);
  const debtAccounts = (accounts ?? []).filter((a) => (a.type === "loan" || a.type === "credit") && !a.hidden);

  const { data: rows, error } = checking.length
    ? await admin
      .from("transaction_flows")
      .select("date, amount, description, merchant, category_detailed, category_id")
      .eq("household_id", householdId)
      .eq("flow", "spending")
      .in("account_id", checking)
      .gte("date", daysAgo(today, 210))
    : { data: [], error: null };
  if (error) throw error;

  const found = detectBills(
    (rows ?? []).map((r) => ({ ...r, amount: -Number(r.amount) })),
    today,
  );

  const { data: existing } = await admin
    .from("bills")
    .select("id, auto, dismissed, detection_key, account_id, amount, due_day, match_key")
    .eq("household_id", householdId);
  const bills = existing ?? [];
  const { data: liabilities } = await admin
    .from("account_liabilities")
    .select("account_id, minimum_payment, next_due_date")
    .eq("household_id", householdId);

  let added = 0;
  let updated = 0;
  const trackedAccounts = new Set(bills.filter((b) => b.account_id && !b.dismissed).map((b) => b.account_id));

  for (const b of found) {
    const match = bills.find((x) => x.detection_key === b.key);
    const stats = { last_paid: b.last_paid, occurrences: b.occurrences };
    if (match) {
      if (match.dismissed) continue;
      const fields = match.auto
        ? { ...stats, amount: b.amount, due_day: b.due_day, is_debt: b.is_debt, debt_kind: b.debt_kind }
        : stats;
      const { error: e } = await admin.from("bills").update(fields).eq("id", match.id);
      if (!e) updated++;
      continue;
    }
    if (!b.active) continue;
    // Already a bill for this payee (e.g. one you added from your payments)?
    const payee = b.key.replace(/#\d+$/, "");
    if (!/#\d+$/.test(b.key) && bills.some((x) => !x.dismissed && x.match_key === payee)) continue;
    // Already entered by hand? (similar amount, due within 3 days)
    const covered = bills.some((x) =>
      !x.detection_key && !x.dismissed && x.amount != null &&
      Math.abs(Number(x.amount) - b.amount) <= 0.1 * b.amount && Math.abs(x.due_day - b.due_day) <= 3
    );
    if (covered) continue;
    const accountId = b.is_debt ? matchLoanAccount(b.key, debtAccounts, b.debt_kind) : null;
    if (accountId && trackedAccounts.has(accountId)) continue; // that loan is already a bill
    const { error: e } = await admin.from("bills").insert({
      household_id: householdId,
      name: b.name,
      amount: b.amount,
      frequency: "monthly",
      due_day: b.due_day,
      is_debt: b.is_debt,
      debt_kind: b.debt_kind,
      account_id: accountId,
      category_id: b.category_id,
      auto: true,
      detection_key: b.key,
      ...stats,
    });
    if (e) console.error("adding detected bill failed:", e.message);
    else {
      added++;
      if (accountId) trackedAccounts.add(accountId);
    }
  }

  // Every connected loan and credit card is a debt: track any that aren't yet.
  for (const a of debtAccounts) {
    const key = `ACCOUNT:${a.id}`;
    if (trackedAccounts.has(a.id) || bills.some((x) => x.detection_key === key)) continue;
    const l = (liabilities ?? []).find((x) => x.account_id === a.id);
    const { error: e } = await admin.from("bills").insert({
      household_id: householdId,
      name: a.name,
      amount: null, // the bank's minimum payment
      frequency: "monthly",
      due_day: l?.next_due_date ? Number(String(l.next_due_date).slice(8, 10)) : 1,
      is_debt: true,
      debt_kind: a.subtype === "auto" ? "auto_loan" : a.subtype === "mortgage" ? "mortgage"
        : a.subtype === "student" ? "student_loan" : a.type === "loan" ? "personal_loan" : null,
      account_id: a.id,
      auto: true,
      detection_key: key,
    });
    if (!e) added++;
  }
  return { found: found.length, added, updated };
}

/** Paychecks and bills, without letting a failure break the caller (e.g. a sync). */
export async function detectPaychecksSafely(admin: SupabaseClient, householdId: string) {
  const result: { paychecks?: unknown; bills?: unknown } = {};
  try {
    result.paychecks = await detectPaychecksForHousehold(admin, householdId);
  } catch (e) {
    console.error("paycheck detection failed:", e instanceof Error ? e.message : e);
  }
  try {
    result.bills = await detectBillsForHousehold(admin, householdId);
  } catch (e) {
    console.error("bill detection failed:", e instanceof Error ? e.message : e);
  }
  return result;
}
