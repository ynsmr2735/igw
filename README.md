# Insta Global Wallet

English-language multi-currency wallet built with Next.js App Router and Supabase. Deployable to Vercel.

## How it works

- The app talks to Supabase only through `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, by calling database functions (RPC) from the server.
- No Supabase Auth: there are no `auth.users` rows and no email confirmation.
- Sign-up (`igw_sign_up`) writes the user into `public.profiles`, with the password stored as a **bcrypt hash** in `profiles.password_hash`. In the same call it creates four starter wallets, a virtual card and saved recipients, and returns a session token.
- The user is signed in right away and redirected to `/dashboard`.
- Sessions are random 32-byte tokens kept in an `httpOnly`, `SameSite=Lax`, `Secure` cookie (`igw_session`). Only the SHA-256 hash of the token is stored in `public.sessions`.
- A session ends after **7 days without activity** (the window slides forward while the user is active) and after **30 days** at most. Sign-out deletes the session in the database, so the old cookie stops working everywhere.
- Sign-in allows **5 failed attempts per email per 15 minutes**; sign-up is limited to 20 new accounts per minute overall.

## Security model

The anon key is public by design, so:

- Every table has RLS enabled with no policies, and the `anon` / `authenticated` roles have no table grants. The anon key cannot read or change any table, including `password_hash`.
- The anon key can only execute the `igw_*` functions. Each one checks the password or session token itself and only touches the caller's own rows.
- Internal helpers live in the `igw_private` schema, which the API does not expose.

## Setup

1. In the Supabase SQL Editor run the whole [`supabase/schema.sql`](supabase/schema.sql). It works on a new project and migrates every earlier version in place.
   Projects that already ran the previous version can instead run [`supabase/migrations/20261120000000_auth_hardening.sql`](supabase/migrations/20261120000000_auth_hardening.sql); the result is identical.
2. In Vercel -> Project Settings -> Environment Variables add (both from the **same** Supabase project):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>
```

   `DATABASE_URL` and `AUTH_SECRET` are no longer used and can be removed. `NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them.
3. Redeploy and open `/api/health`: it should return `{"ok":true,"supabase":"ok","schema":"igw-rpc-2"}`.

## Local development

```bash
cp .env.example .env.local   # fill in the two Supabase values
npm install
npm run dev
```

## Database functions

| Function | Purpose |
| --- | --- |
| `igw_sign_up(p_full_name, p_email, p_password)` | Create account + starter data, returns `{ ok, token }` |
| `igw_sign_in(p_email, p_password)` | Check password, returns `{ ok, token }` |
| `igw_sign_out(p_token)` | Delete the session |
| `igw_me(p_token)` | Signed-in profile or `null` |
| `igw_dashboard(p_token)` | Wallets, last 30 transactions, cards, recipients, 30-day flows |
| `igw_wallet_action(p_token, p_action, ...)` | `topup`, `withdraw`, `exchange`, `send`, `toggleCard` (atomic) |
| `igw_health()` | Used by `/api/health` |

## Main routes

| Route | Description |
| --- | --- |
| `/` | Public landing page |
| `/signup` | Create account (signs in and opens the dashboard) |
| `/login` | Sign in |
| `/dashboard` | Protected wallet dashboard |
| `/api/dashboard` | Current user's wallet data |
| `/api/transactions` | Wallet action endpoint |
| `/api/health` | Health check |

## Notes

- Passwords are limited to 72 bytes (bcrypt limit).
- There is no email verification and no password reset: both need an email-sending service, which this project does not have configured.
- Accounts created by the old Supabase-Auth version have no password hash and cannot sign in; delete those rows from `public.profiles` so the people can sign up again.
