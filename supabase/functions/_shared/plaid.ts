// Minimal Plaid API client for Supabase Edge Functions (Deno).
//
// Credentials come from function secrets set in the Supabase dashboard:
//   PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox | production)

const HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export class PlaidError extends Error {
  constructor(
    public status: number,
    public code: string,
    public type: string,
    public requestId?: string,
  ) {
    super(`Plaid ${code}`);
  }
  /** The bank login needs the user to reconnect (Link update mode). */
  get needsReconnect() {
    return [
      "ITEM_LOGIN_REQUIRED",
      "PENDING_EXPIRATION",
      "PENDING_DISCONNECT",
      "ACCESS_NOT_GRANTED",
      "INVALID_ACCESS_TOKEN",
      "ITEM_NOT_FOUND",
    ].includes(this.code);
  }
}

function config() {
  const clientId = Deno.env.get("PLAID_CLIENT_ID");
  const secret = Deno.env.get("PLAID_SECRET");
  const env = (Deno.env.get("PLAID_ENV") ?? "sandbox").trim().toLowerCase();
  if (!clientId || !secret) throw new Error("PLAID_CLIENT_ID and PLAID_SECRET must be set");
  const host = HOSTS[env];
  if (!host) throw new Error(`Unknown PLAID_ENV "${env}"`);
  return { clientId, secret, host };
}

export async function plaid<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { clientId, secret, host } = config();
  const res = await fetch(`${host}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PLAID-CLIENT-ID": clientId,
      "PLAID-SECRET": secret,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Log codes only; never log request bodies (they hold access tokens).
    console.error(
      `Plaid ${path} -> ${res.status} ${data.error_type}/${data.error_code} (request ${data.request_id})`,
    );
    throw new PlaidError(res.status, data.error_code ?? "UNKNOWN", data.error_type ?? "", data.request_id);
  }
  return data as T;
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string; // depository | credit | loan | investment | other
  subtype: string | null;
  balances: {
    available: number | null;
    current: number | null;
    iso_currency_code: string | null;
  };
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number; // positive = money out (Plaid convention)
  date: string;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  personal_finance_category?: { primary: string; detailed: string } | null;
}

export interface TransactionsSyncResponse {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
}

export interface LiabilitiesResponse {
  liabilities: {
    credit?: {
      account_id: string | null;
      aprs?: { apr_percentage: number; apr_type: string }[];
      minimum_payment_amount?: number | null;
      next_payment_due_date?: string | null;
      last_statement_balance?: number | null;
    }[] | null;
    student?: {
      account_id: string | null;
      interest_rate_percentage?: number | null;
      minimum_payment_amount?: number | null;
      next_payment_due_date?: string | null;
      last_statement_balance?: number | null;
    }[] | null;
    mortgage?: {
      account_id: string | null;
      interest_rate?: { percentage?: number | null } | null;
      next_monthly_payment?: number | null;
      next_payment_due_date?: string | null;
    }[] | null;
  };
}
