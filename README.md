# Insta Global Wallet

Multi-user USD wallet built with Next.js App Router and Supabase: 8-digit account numbers, Bitcoin (Mainnet) deposits approved by an admin after on-chain verification, member-to-member transfers, notifications and an admin panel. Deployable to Vercel.

## Features

| Area | What it does |
| --- | --- |
| Account number | Every member gets a random, unique, permanent 8-digit number (e.g. `58392014`) at sign-up. Shown with a copy button on the dashboard and profile. A database trigger forbids changing it. |
| Balance | One USD balance per member, starting at **0.00**. It changes only inside database functions (approved deposits, transfers). Balances can never go negative. |
| BTC deposit | Member enters a USD amount → server fetches the BTC/USD price (mempool.space + Coinbase, must agree within 2 %) → member sees the admin's Mainnet address, the **exact** BTC amount, a QR code and instructions → after paying, enters the TXID and presses **I've paid** → status *Under review*; admins are notified. **The balance does not change.** |
| Admin review | Admin checks the TXID on the blockchain (mempool.space + blockstream.info): right address, exact satoshi amount, paid within the quote window, enough confirmations, both explorers agree. Only then can it be approved; the balance is credited once, atomically. Or rejected with a reason. The member is notified either way. |
| Transfers | Recipient's 8-digit account number → masked name shown for confirmation → confirm. Atomic, row-locked, idempotent (a retry or double click never sends twice), unique `TRF…` reference, both sides get a history entry and a notification. |
| History | Reference, type, amount, date, status and description for deposits, transfers sent/received (withdrawals are prepared as a type, the feature is "coming soon"). |
| Admin panel | `/admin`: notifications (new requests highlighted), deposit requests by status with user details, blockchain check, approve/reject, all transactions, deposit address settings. Members get a 404. |

## How it is secured

- The browser never talks to Supabase. The Next.js server calls database functions (RPC).
- **Anon / publishable key** (public): can only call `igw_*` functions that check the session token themselves. Every table has RLS on, no policies, and no grants for `anon` / `authenticated`.
- **Service role key** (secret, server-only): required for the three functions that take trusted input from the server — `igw_deposit_create` (BTC price), `igw_admin_approve` (blockchain verification), `igw_admin_set_btc_address`. With only the public key nobody can choose a price or fake an approval.
- Admin rights come from the `public.admin_roles` table, which only the database owner can change (SQL Editor). Not from usernames or emails.
- Each open deposit request has a unique satoshi amount, so a payment matches exactly one request; every TXID can be claimed once.
- Sessions: random token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie; only its SHA-256 hash is stored; 7-day idle / 30-day absolute expiry. Passwords: bcrypt. Sign-in throttled (5 failures / 15 min).
- No secrets or personal data are written to logs.

## Setup

1. **Database** — in the Supabase SQL Editor of the project your site uses, run the whole [`supabase/schema.sql`](supabase/schema.sql) (fresh or existing project; idempotent; keeps existing balances). Projects that ran the previous version can run [`supabase/migrations/20261120000100_wallet_btc_transfers.sql`](supabase/migrations/20261120000100_wallet_btc_transfers.sql) instead — the result is identical.
2. **Environment variables** (Vercel → Settings → Environment Variables), all from the same Supabase project:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<service_role or sb_secret_ key>   # secret, server-only
   ```

   Redeploy afterwards (`NEXT_PUBLIC_*` values are baked in at build time).
3. **Admin account** (no password is stored in code):
   1. Sign up on the website with the admin's email address and a strong password.
   2. In the SQL Editor run: `select igw_private.grant_admin('admin-email@example.com', 'enkyryyss');`
   3. Sign in with the email or the username `enkyryyss`; the **Admin panel** link appears in the sidebar.
   To remove: `select igw_private.revoke_admin('admin-email@example.com');`
4. **Deposit address** — in `/admin` → Settings enter the Bitcoin **Mainnet** address that should receive deposits (`bc1…`, `1…` or `3…`; checksum verified, testnet refused). Until then members see "deposits are not available yet".
5. Open `/api/health`: expect `{"ok":true,"supabase":"ok","schema":"igw-rpc-3","serviceKey":"configured"}`.

Defaults (change in the SQL Editor, table `public.app_settings`): 2 confirmations, min 10 USD, max 10,000 USD, quote valid 60 minutes.

## Database

Tables: `profiles` (+ `account_number`, `username`), `wallets`, `transactions` (+ `reference`, `status`, `description`), `deposit_requests`, `transfers`, `notifications`, `admin_roles`, `app_settings`, `sessions`, `login_attempts`, `transfer_lookups`. Legacy demo tables `cards`, `recipients`, `exchange_rates` are kept (unused) so no data is lost; non-USD demo wallets are kept but hidden.

## Not included (needs your decision / services)

- **Withdrawals**: prepared as a transaction type, the button shows "soon". Paying out BTC needs a custody/payout process.
- **Email notifications**: notifications are in-app (dashboard and admin panel). Email would need an email-sending service.
- **Automatic payment detection**: the admin triggers the blockchain check per request. Fully automatic crediting would need a background job.
- **Per-user deposit addresses**: all members pay to one admin address; unique satoshi amounts tell payments apart. Per-user addresses need an xpub/HD wallet setup.
- Holding and transferring customer funds may require licences (e.g. money transmission, KYC/AML) depending on your jurisdiction.

## Local development

```bash
cp .env.example .env.local   # fill in the three Supabase values
npm install
npm run dev
```
