# Budget

A private budgeting app for our household. It runs as a website and as an
iPhone app from one codebase, and pulls balances and transactions from our
banks automatically through [Plaid](https://plaid.com).

- **Overview:** cash on hand, credit card balances, and this month's income,
  spending and net, plus spending by category against each budget.
- **Transactions:** searchable by month. Tap one to change its category, add
  a note, or exclude it from the budget. Transfers between your own accounts
  and credit card payments are excluded automatically.
- **Budgets:** a monthly limit per category, with progress bars.
- **Accounts:** connect banks, sync now, reconnect a bank that needs you to
  sign in again, hide accounts, and share the household invite code.

## How it fits together

```
iPhone app / website (Expo + React Native)
   │  sign in, read and edit data (Row Level Security)
   ▼
Supabase: Postgres + Auth + Edge Functions + Vault
   │  plaid-link-token  short-lived token to open Plaid Link
   │  plaid-exchange    trades Link's one-time token for an access token
   │  plaid-sync        balances + transactions (button, and daily at 11:17 UTC)
   │  plaid-disconnect  revokes access at Plaid, then deletes the bank's data
   ▼
Plaid API ──► your banks
```

### Security model
- Bank sign-in happens inside **Plaid Link**. The app never sees bank
  usernames or passwords.
- Plaid **access tokens** are encrypted in **Supabase Vault**. Only the Edge
  Functions can decrypt them. The app and signed-in users can't, and that's
  tested.
- Every row belongs to one **household**. Row Level Security limits reads to
  its members, and members can only edit their own fields (category, notes,
  budgets, hidden accounts). They can never edit amounts, balances, the invite
  code or bank connections.
- **Removing a bank revokes access at Plaid first**, then deletes its data and
  wipes the token.
- The daily sync authenticates with a random secret that's generated in the
  database and kept in Vault.
- Manual syncs are limited to once a minute. Functions only accept browser
  requests from the app's own website, and errors shown to users never include
  internal details.
- **iPhone:** the login session is stored in the Keychain. The app locks with
  Face ID or your passcode after a minute in the background.
- Passwords must be at least 10 characters.

| Path | What's there |
|---|---|
| `src/app/` | Screens (Expo Router). `(tabs)/` holds the four main tabs. |
| `src/components/plaid-link*.tsx` | Plaid Link: Plaid's script on web, Plaid's SDK on iPhone |
| `src/lib/` | Supabase client, Keychain storage, auth/household context, data helpers |
| `supabase/migrations/` | Database schema, security rules, default categories, daily schedule |
| `supabase/functions/` | The four Plaid Edge Functions |

## Setup status

The Supabase project (`fdlwfkgnsooulmrfyobv`) is already set up: database,
security rules, functions and the daily sync. `.env` holds its public URL and
publishable key. What's left:

### 1. Add your Plaid keys to Supabase (one time)

1. In the Plaid dashboard (dashboard.plaid.com), open **Developers → Keys**.
   Copy your **client_id** and your **Sandbox** secret.
2. In Supabase (supabase.com/dashboard), open the **budgetapp** project →
   **Edge Functions → Secrets** and add:

| Name | Value |
|---|---|
| `PLAID_CLIENT_ID` | your client_id |
| `PLAID_SECRET` | your Sandbox secret |
| `PLAID_ENV` | `sandbox` |

Never put the Plaid secret in the app or in git.

### 2. Run it

```bash
npm install
npm run web        # http://localhost:8081
```

Create an account, create your household, then go to **Accounts → Connect a
bank**. In sandbox, pick any bank and sign in with username `user_good` and
password `pass_good`.

### 3. Real banks (when sandbox works)

1. In the Plaid dashboard, request **Production** access for the
   **Transactions** product. Some big banks (Chase, Wells Fargo and others)
   also need Plaid's OAuth registration, which the dashboard walks you through.
2. In Supabase secrets, set `PLAID_SECRET` to your **Production** secret and
   `PLAID_ENV` to `production`.
3. Banks connected in sandbox don't carry over. Remove them and connect the
   real ones.

### 4. The website (Vercel)

`vercel.json` holds everything Vercel needs: the build command, single-page
routing, caching, and strict security headers (a Content Security Policy that
only allows this app, Supabase and Plaid; no framing; HTTPS only). The site is
marked `noindex` so search engines skip it.

1. At vercel.com, sign in with GitHub, choose **Add New → Project** and import
   `budgetapp`. Keep the detected settings and click **Deploy**.
2. Copy the site address, e.g. `https://budgetapp-abc.vercel.app`.
3. In Supabase:
   - **Edge Functions → Secrets:** add `ALLOWED_ORIGINS` with that address
     (comma-separate several). Without it, connecting banks and syncing from
     the website are refused.
   - **Authentication → URL Configuration:** set **Site URL** to the address.

Every push to `main` redeploys the site automatically.

## On your iPhones

- **Installable app (free):** open the website in Safari → **Share → Add to
  Home Screen**. It gets the Budget icon and opens full screen like an app.
- **Full native app (later):** needs an Apple Developer account ($99/year).
  `eas.json` is ready: `npx eas-cli@latest build --profile production
  --platform ios`, then `npx eas-cli@latest submit --platform ios` to send it
  to TestFlight. This adds Face ID and the native Plaid screen.
- **While developing:** Expo Go (`npx expo start`, scan the QR code).

## Maintenance notes

- `supabase/migrations/` file names match what's applied to the live
  project. Add new changes as new migration files.
- The old, empty Teller token table was moved to a private `legacy` schema.
  Remove it in the SQL Editor with `drop schema legacy cascade;` once you're
  sure.
- Supabase's advisor flags `pg_net` living in the `public` schema. It's
  harmless here (its functions live in the `net` schema). Moving it means
  reinstalling the extension.
