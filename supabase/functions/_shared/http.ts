// Small HTTP + auth helpers for Edge Functions that don't talk to Plaid.
// (The Plaid functions use the equivalents in sync.ts.)
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

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

export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
      console.error(e);
      return json(req, { error: "Something went wrong. Please try again." }, 500);
    }
  });
}

export function safeEqual(a: string, b: string) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** True when the request carries the scheduler's secret (kept in Vault). */
export async function isCron(req: Request, admin: SupabaseClient) {
  const provided = req.headers.get("x-cron-secret");
  if (!provided) return false;
  const { data: expected, error } = await admin.rpc("get_cron_secret");
  if (error) throw error;
  if (!expected || !safeEqual(provided, expected as string)) throw new HttpError(401, "Unauthorized");
  return true;
}

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
