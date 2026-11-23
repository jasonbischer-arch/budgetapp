# Budget

A private budgeting app for our household. It runs as a website and as an
iPhone app from one codebase, and it pulls balances and transactions from our
banks automatically through [Teller](https://teller.io).

- **Overview:** cash on hand, credit card balances, and this month's income,
  spending and net, plus spending by category against each budget.
- **Transactions:** searchable by month. Tap one to change its category, add
  a note, or exclude it from the budget (transfers, card payments).
- **Budgets:** a monthly limit per category, with progress bars.
- **Accounts:** connect banks, sync now, reconnect a bank that needs you to
  sign in again, hide accounts, and share the household invite code.

## How it fits together

```
iPhone app / website (Expo + React Native)
   │  sign in, read and edit data (Row Level Security)
   ▼
Supabase: Postgres + Auth + Edge Functions
   │  teller-enroll: saves the bank token, first sync
   │  teller-sync:   refreshes balances and transactions (button + daily job)
   ▼
Teller API (mTLS) ──► your banks
```

- Bank logins happen inside **Teller Connect**. The app never sees bank
  usernames or passwords.
- Teller returns an **access token** per bank login. It is stored only in the
  `teller_tokens` table, which the app can't read. Only the Edge Functions
  (service role) can use it.
- Each person has their own login. Both belong to one **household**, and every
  row is scoped to it by Row Level Security.

| Path | What's there |
|---|---|
| `src/app/` | Screens (Expo Router). `(tabs)/` holds the four main tabs. |
| `src/components/teller-connect*.tsx` | Teller Connect: script on web, WebView on iPhone |
| `src/lib/` | Supabase client, auth/household context, data helpers |
| `supabase/migrations/` | Database schema, security rules, default categories |
| `supabase/functions/` | `teller-enroll` and `teller-sync` Edge Functions |

## Setup

You need: a free [Supabase](https://supabase.com) account, a
[Teller](https://teller.io) developer account, and Node 20+.

### 1. Supabase

1. Create a project at supabase.com.
2. Create the database: open **SQL Editor**, paste in
   `supabase/migrations/20261123000000_init.sql` and run it. (Or use the CLI:
   `npx supabase link --project-ref <ref>` then `npx supabase db push`.)
3. **Authentication → Providers → Email**: keep it on. For a two-person app
   you can turn off "Confirm email" to skip the confirmation email.
4. **Project Settings → API**: copy the Project URL and the `anon` public key.

### 2. Teller

1. Sign up at teller.io and create an application. Copy the **Application ID**.
2. Download the **certificate** (`certificate.pem` and `private_key.pem`).
   The sandbox works without it. Real banks require it.
3. Environments:
   - `sandbox`: fake banks. In Teller Connect, sign in with username
     `username` and password `password`.
   - `development`: your real banks, with a small free allowance of
     connections. Check Teller's current limits.
   - `production`: real banks, with Teller's paid plan.

### 3. Edge Functions

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase secrets set \
  TELLER_CERT="$(cat certificate.pem)" \
  TELLER_KEY="$(cat private_key.pem)" \
  CRON_SECRET="$(openssl rand -hex 24)"
npx supabase functions deploy teller-enroll teller-sync
```

Keep `certificate.pem`, `private_key.pem` and the cron secret out of git.
`.gitignore` already ignores `*.pem`.

### 4. Daily automatic sync

In the SQL Editor, turn on the `pg_cron` and `pg_net` extensions
(**Database → Extensions**) and run this. Replace the project ref and use the
same `CRON_SECRET` you set above:

```sql
select cron.schedule(
  'teller-daily-sync',
  '17 11 * * *',  -- every day at 11:17 UTC
  $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/teller-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<your CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

The **Sync now** button on the Accounts tab refreshes on demand.

### 5. Run the app

```bash
cp .env.example .env.local   # fill in Supabase URL/key and Teller app id
npm install
npm run web                  # website at http://localhost:8081
npx expo start               # scan the QR code with Expo Go on iPhone
```

First run: create an account, create the household, and connect a bank from
the **Accounts** tab. Your partner then creates their own account and joins
with the invite code shown on that tab.

## Getting it on your iPhones

- **While building:** install **Expo Go** from the App Store and scan the QR
  code from `npx expo start`.
- **As a real app:** an Apple Developer account ($99/year) lets you run
  `npx eas-cli@latest build --platform ios` and install through **TestFlight**,
  which is private to the people you invite.
- **Website:** `npx expo export --platform web` produces a static site in
  `dist/` for Netlify, Vercel or Cloudflare Pages. On iPhone, Safari's
  **Share → Add to Home Screen** works too.

## To check before relying on it

- **Amount signs:** the app assumes Teller reports money out as a negative
  amount on every account type. Connect a sandbox credit card and confirm
  purchases show as spending. If they don't, flip the sign for `credit`
  accounts in `supabase/functions/_shared/sync.ts`.
- **Credit card payments and transfers** show up twice (out of checking,
  into the card). Mark them **Exclude from budget** so they aren't counted as
  spending.
