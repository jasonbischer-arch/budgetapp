// Minimal Teller API client for Supabase Edge Functions (Deno).
//
// Teller authenticates with HTTP Basic auth (access token as the username)
// and, outside the sandbox, a client certificate (mTLS). Put the certificate
// and private key from the Teller dashboard in the TELLER_CERT and
// TELLER_KEY secrets (PEM text).

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
    super(`Teller API ${status}: ${body}`);
  }
  /** The bank login needs to be reconnected by the user. */
  get needsReconnect() {
    return this.status === 401 || this.status === 403 || this.status === 404;
  }
}

export async function tellerGet<T>(path: string, accessToken: string): Promise<T> {
  const client = getClient();
  const res = await fetch(`${TELLER_API}${path}`, {
    headers: {
      Authorization: `Basic ${btoa(`${accessToken}:`)}`,
      Accept: "application/json",
    },
    ...(client ? { client } : {}),
  } as RequestInit);
  if (!res.ok) throw new TellerError(res.status, await res.text());
  return (await res.json()) as T;
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
