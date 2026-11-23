import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  TellerAccount,
  TellerBalance,
  TellerError,
  tellerGet,
  TellerTransaction,
} from "./teller.ts";

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

/** Runs a handler with CORS preflight and safe error responses. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
      // Log the details for us; show users a generic message.
      console.error(e);
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

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Teller returns transactions newest first. The first sync pulls a long
// history; later syncs re-read the most recent batch, which catches new
// transactions, pending -> posted changes and late corrections.
const INITIAL_HISTORY_COUNT = 1000;
const INCREMENTAL_COUNT = 250;

export interface SyncResult {
  enrollmentId: string;
  accounts: number;
  transactions: number;
  status: "active" | "disconnected" | "error";
  error?: string;
}

export async function syncEnrollment(
  admin: SupabaseClient,
  enrollmentId: string,
  householdId: string,
): Promise<SyncResult> {
  const token = await getToken(admin, enrollmentId);
  if (!token) {
    return { enrollmentId, accounts: 0, transactions: 0, status: "error", error: "Missing token" };
  }

  const { data: enrollment } = await admin
    .from("teller_enrollments")
    .select("last_synced_at")
    .eq("id", enrollmentId)
    .single();
  const firstSync = !enrollment?.last_synced_at;

  try {
    const accounts = await tellerGet<TellerAccount[]>("/accounts", token);
    let txnCount = 0;

    for (const acct of accounts) {
      let balance: TellerBalance | null = null;
      if (acct.status === "open") {
        balance = await tellerGet<TellerBalance>(`/accounts/${acct.id}/balances`, token)
          .catch(() => null);
      }

      const { error: acctErr } = await admin.from("accounts").upsert({
        id: acct.id,
        household_id: householdId,
        enrollment_id: enrollmentId,
        name: acct.name,
        institution_name: acct.institution?.name ?? null,
        type: acct.type,
        subtype: acct.subtype,
        last_four: acct.last_four,
        currency: acct.currency,
        status: acct.status,
        balance_available: balance?.available != null ? Number(balance.available) : null,
        balance_ledger: balance?.ledger != null ? Number(balance.ledger) : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id", ignoreDuplicates: false });
      if (acctErr) throw acctErr;

      if (acct.status !== "open") continue;

      const count = firstSync ? INITIAL_HISTORY_COUNT : INCREMENTAL_COUNT;
      const txns = await tellerGet<TellerTransaction[]>(
        `/accounts/${acct.id}/transactions?count=${count}`,
        token,
      );

      // Upsert only Teller-owned columns, so category/notes you set are kept.
      const rows = txns.map((t) => ({
        id: t.id,
        household_id: householdId,
        account_id: acct.id,
        date: t.date,
        description: t.description,
        merchant: t.details?.counterparty?.name ?? null,
        amount: Number(t.amount),
        status: t.status,
        teller_category: t.details?.category ?? null,
        updated_at: new Date().toISOString(),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("transactions").upsert(rows.slice(i, i + 500), {
          onConflict: "id",
        });
        if (error) throw error;
      }
      txnCount += rows.length;

      // A pending transaction often gets a new id once it posts. Drop pending
      // rows within the re-read date range that Teller no longer returns.
      if (!firstSync && rows.length) {
        const oldest = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
        const seen = new Set(rows.map((r) => r.id));
        const { data: pending } = await admin
          .from("transactions")
          .select("id")
          .eq("account_id", acct.id)
          .eq("status", "pending")
          .gte("date", oldest);
        const stale = (pending ?? []).map((p) => p.id).filter((id) => !seen.has(id));
        if (stale.length) await admin.from("transactions").delete().in("id", stale);
      }
    }

    await admin.from("teller_enrollments").update({
      status: "active",
      last_error: null,
      last_synced_at: new Date().toISOString(),
    }).eq("id", enrollmentId);

    return { enrollmentId, accounts: accounts.length, transactions: txnCount, status: "active" };
  } catch (e) {
    const disconnected = e instanceof TellerError && e.needsReconnect;
    console.error(`sync ${enrollmentId} failed`, e);
    // Store a user-facing message only; details stay in the function logs.
    const message = disconnected
      ? "The bank needs you to sign in again."
      : e instanceof TellerError
      ? "The bank connection is temporarily unavailable."
      : "Sync failed. We'll retry on the next sync.";
    await admin.from("teller_enrollments").update({
      status: disconnected ? "disconnected" : "error",
      last_error: message,
    }).eq("id", enrollmentId);
    return {
      enrollmentId,
      accounts: 0,
      transactions: 0,
      status: disconnected ? "disconnected" : "error",
      error: message,
    };
  }
}

/** Decrypts an enrollment's Teller token from Vault (service role only). */
export async function getToken(admin: SupabaseClient, enrollmentId: string) {
  const { data, error } = await admin.rpc("get_teller_token", { p_enrollment_id: enrollmentId });
  if (error) throw error;
  return (data as string | null) ?? null;
}
