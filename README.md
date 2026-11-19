# Insta Global Wallet

English-language multi-currency wallet built with Next.js App Router, PostgreSQL (Supabase) and Drizzle. Deployable to Vercel.

## How authentication works

- No Supabase Auth: there are no `auth.users` rows and no email confirmation.
- Sign-up writes the user straight into `public.profiles`. The password is stored as a **scrypt hash** in `profiles.password_hash` (Node's built-in `crypto`, salt per user).
- In the same database transaction the user gets four starter wallets, a virtual card and saved recipients.
- Right after sign-up the user is signed in and redirected to `/dashboard`.
- The session is an HMAC-SHA256 signed, `httpOnly` cookie (`igw_session`, 7 days), signed with `AUTH_SECRET`.
- `src/proxy.ts` blocks `/dashboard` and the wallet APIs without a valid session.

## Setup

1. In the Supabase SQL Editor run [`supabase/schema.sql`](supabase/schema.sql). It works on a new project and also migrates the old Supabase-Auth version in place.
2. In Vercel -> Project Settings -> Environment Variables add:

```bash
DATABASE_URL=postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:6543/postgres
AUTH_SECRET=<at least 32 random characters>
```

   Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   The old `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` variables are no longer used and can be removed.
3. Redeploy and open `/api/health`: it should return `{"ok":true,"database":"ok","authSecret":true}`.

## Local development

```bash
cp .env.example .env.local   # fill in DATABASE_URL and AUTH_SECRET
npm install
npm run dev
```

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

## Security notes

- The database is only reached from the server through `DATABASE_URL`. RLS is enabled with no policies and the `anon` / `authenticated` roles have no table grants, so the public Supabase API cannot read `password_hash` or wallet data.
- Every wallet query and mutation is filtered by the signed-in user's id.
- Keep `AUTH_SECRET` private; changing it signs everyone out.
- There is no rate limiting on sign-in yet; add one before real use.
