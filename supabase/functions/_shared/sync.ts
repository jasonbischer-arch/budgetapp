import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  TellerAccount,
  TellerBalance,
  TellerError,
  tellerGet,
  TellerTransaction,
} from "./teller.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  const { data: tokenRow } = await admin
    .from("teller_tokens")
    .select("access_token")
    .eq("enrollment_id", enrollmentId)
    .single();
  if (!tokenRow) {
    return { enrollmentId, accounts: 0, transactions: 0, status: "error", error: "Missing token" };
  }
  const token = tokenRow.access_token as string;

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
    const message = e instanceof Error ? e.message : String(e);
    await admin.from("teller_enrollments").update({
      status: disconnected ? "disconnected" : "error",
      last_error: message.slice(0, 500),
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
