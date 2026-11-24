// Receives Plaid webhooks, so new data shows up as soon as Plaid has it
// instead of waiting for the daily sync. The key case: right after you
// connect a bank, Plaid has only ~30 days ready; the older history (up to
// 2 years) arrives minutes to hours later with SYNC_UPDATES_AVAILABLE.
//
// Every webhook is verified before anything happens: Plaid signs the body
// (ES256 JWT in the Plaid-Verification header) and we check the signature
// with Plaid's published key, the body's SHA-256 and the timestamp.
import { adminClient, detectPaychecksSafely, HttpError, json, safeEqual, serve, syncItem } from "../_shared/sync.ts";
import { plaid } from "../_shared/plaid.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const MAX_AGE_SECONDS = 5 * 60;
const keyCache = new Map<string, CryptoKey>();

const b64urlToBytes = (s: string) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function verificationKey(kid: string): Promise<CryptoKey> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  const { key } = await plaid<{ key: JsonWebKey & { expired_at: number | null } }>(
    "/webhook_verification_key/get",
    { key_id: kid },
  );
  if (key.expired_at) throw new HttpError(401, "Expired key");
  const crypto_key = await crypto.subtle.importKey(
    "jwk",
    { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  keyCache.set(kid, crypto_key);
  return crypto_key;
}

async function verify(req: Request, body: string) {
  const token = req.headers.get("Plaid-Verification") ?? "";
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Unverified");
  let header: { alg?: string; kid?: string };
  let payload: { iat?: number; request_body_sha256?: string };
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    throw new HttpError(401, "Unverified");
  }
  if (header.alg !== "ES256" || typeof header.kid !== "string") throw new HttpError(401, "Unverified");

  const key = await verificationKey(header.kid);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new HttpError(401, "Unverified");
  if (typeof payload.iat !== "number" || Math.abs(Date.now() / 1000 - payload.iat) > MAX_AGE_SECONDS) {
    throw new HttpError(401, "Unverified");
  }
  const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  if (!payload.request_body_sha256 || !safeEqual(digest, payload.request_body_sha256)) {
    throw new HttpError(401, "Unverified");
  }
}

const SYNC_CODES = new Set(["SYNC_UPDATES_AVAILABLE", "INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE"]);
const RECONNECT_CODES = new Set(["PENDING_EXPIRATION", "PENDING_DISCONNECT", "USER_PERMISSION_REVOKED"]);

serve(async (req) => {
  const body = await req.text();
  await verify(req, body);

  const event = JSON.parse(body) as {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
    error?: { error_code?: string } | null;
  };
  if (typeof event.item_id !== "string") return json(req, { ok: true });

  const admin = adminClient();
  const { data: item } = await admin
    .from("bank_items")
    .select("id, household_id")
    .eq("id", event.item_id)
    .maybeSingle();
  if (!item) return json(req, { ok: true }); // a bank that was removed

  if (event.webhook_type === "TRANSACTIONS" && SYNC_CODES.has(event.webhook_code ?? "")) {
    // Answer Plaid right away; a first sync with 2 years of history can take
    // longer than Plaid waits for a reply.
    EdgeRuntime.waitUntil((async () => {
      await syncItem(admin, item.id, item.household_id);
      await detectPaychecksSafely(admin, item.household_id);
    })());
  } else if (
    event.webhook_type === "ITEM" &&
    (RECONNECT_CODES.has(event.webhook_code ?? "") ||
      (event.webhook_code === "ERROR" && event.error?.error_code === "ITEM_LOGIN_REQUIRED"))
  ) {
    await admin.from("bank_items").update({
      status: "disconnected",
      last_error: "The bank needs you to sign in again.",
    }).eq("id", item.id);
  }
  return json(req, { ok: true });
});
