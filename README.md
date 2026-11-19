# Insta Global Wallet — Option B

English-language multi-currency wallet built with Next.js App Router, PostgreSQL/Drizzle and optional Supabase Auth + Supabase tables. Deployable to Vercel.

## What is included

- Marketing landing page, sign-up and sign-in screens, and a protected wallet dashboard.
- Email/password authentication through Supabase Auth with cookie-based SSR sessions (`@supabase/ssr`).
- Supabase tables for `profiles`, `wallets`, `cards`, `recipients`, `transactions` and `exchange_rates`, protected by Row Level Security.
- Atomic wallet operations (send, top up, withdraw, exchange, freeze card) through the `execute_wallet_action` Postgres function.
- A new-user trigger that creates a profile, four starter wallets, a virtual card and saved recipients automatically.
- Demo fallback: when Supabase keys are absent, the same UI works against the local PostgreSQL database with cookie-based demo sessions.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run [`supabase/schema.sql`](supabase/schema.sql). It creates tables, RLS policies, the signup trigger and the transaction RPC.
3. In Supabase Authentication -> URL Configuration, set the Site URL to your deployed domain and add `https://your-domain/auth/callback` as a redirect URL.
4. Copy the project URL and anon/publishable key into Vercel environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

5. Deploy to Vercel. `npm run build` is used automatically.

## Local development

```bash
npm install
npx drizzle-kit push
npm run dev
```

Without the Supabase variables the app runs in **Demo mode**: sign up with any new email, or sign in with the seeded account `deniz@instaglobalwallet.com` / `demo1234`.

With the Supabase variables present, sign-up and sign-in use real Supabase Auth, and all dashboard data and mutations go directly to the Supabase tables. The dashboard shows which mode is active.

## Main routes

| Route | Description |
| --- | --- |
| `/` | Public landing page |
| `/signup` | Create account |
| `/login` | Sign in |
| `/dashboard` | Protected wallet dashboard |
| `/api/dashboard` | Current user's wallet data |
| `/api/transactions` | Wallet action endpoint |
| `/api/health` | Health check |
| `/auth/callback` | Supabase code exchange |

## Security notes

- All Supabase tables use RLS; users can only read and write their own rows.
- `execute_wallet_action` is `security definer` but checks `auth.uid()` ownership before every mutation.
- Never expose a service-role key to the browser. Only the public URL and anon/publishable key are used by this app.
