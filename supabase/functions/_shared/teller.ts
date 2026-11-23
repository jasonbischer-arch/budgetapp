// Minimal Teller API client for Supabase Edge Functions (Deno).
//
// Teller authenticates with HTTP Basic auth (access token as the username)
// and, outside the sandbox, a client certificate (mTLS). The certificate and
// private key from the Teller dashboard live in the TELLER_CERT and
// TELLER_KEY function secrets (PEM text).

const TELLER_API = "https://api.teller.io";

let httpClient: Deno.HttpClient | undefined;

function getClient(): Deno.HttpClient | undefined {
  const cert = Deno.env.get("TELLER_CERT");
  const key = Deno.env.get("TELLER_KEY");
  if (!cert || !key) return undefined; // sandbox works without mTLS
  httpClient ??= Deno.createHttpClient({ cert, key });
  return httpClient;
}

export class TellerError extends Error {
  constructor(public status: number, public body: string) {
    super(`Teller API ${status}`);
  }
  /** The bank login needs to be reconnected by the user. */
  get needsReconnect() {
    return this.status === 401 || this.status === 403 || this.status === 404;
  }
}

async function tellerRequest(method: string, path: string, accessToken: string) {
  const client = getClient();
  const res = await fetch(`${TELLER_API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${accessToken}:`)}`,
      Accept: "application/json",
    },
    ...(client ? { client } : {}),
  } as RequestInit);
  if (!res.ok) {
    const body = await res.text();
    console.error(`Teller ${method} ${path.split("?")[0]} -> ${res.status}: ${body.slice(0, 300)}`);
    throw new TellerError(res.status, body);
  }
  return res;
}

export async function tellerGet<T>(path: string, accessToken: string): Promise<T> {
  return (await (await tellerRequest("GET", path, accessToken)).json()) as T;
}

/** Revokes this app's access to every account behind the token. */
export async function tellerRevoke(accessToken: string) {
  await tellerRequest("DELETE", "/accounts", accessToken);
}

export interface TellerAccount {
  id: string;
  name: string;
  type: "depository" | "credit";
  subtype: string;
  last_four: string;
  currency: string;
  status: string;
  enrollment_id: string;
  institution: { id: string; name: string };
}

export interface TellerBalance {
  account_id: string;
  available: string | null;
  ledger: string | null;
}

export interface TellerTransaction {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amount: string;
  status: "posted" | "pending";
  details?: {
    category?: string | null;
    counterparty?: { name?: string | null; type?: string | null } | null;
  };
}
