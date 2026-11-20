# Insta Global Wallet

Multi-user USD wallet built with Next.js App Router and Supabase: 8-digit account numbers, **Bitcoin (BTC)** and **Tether USDT (TRC20)** deposits approved manually by an admin after on-chain verification, member-to-member transfers, notifications and an admin panel. Deployable to Vercel.

## Features

| Area | What it does |
| --- | --- |
| Account number | Every member gets a random, unique, permanent 8-digit number (e.g. `58392014`) at sign-up. Shown with a copy button on the dashboard and profile. A database trigger forbids changing it. |
| Balance | One USD balance per member, starting at **0.00**. It changes only inside database functions (approved deposits, transfers). Balances can never go negative. |
| Payment methods | Two methods, each with its own address (stored in the database, set by the admin — never in code) and its own Active/Inactive switch: **Bitcoin (BTC)** on Bitcoin Mainnet and **Tether (USDT TRC20)** on the TRON network. The member picks one on the deposit screen. |
| USDT TRC20 deposit | Member enters a USD amount → 1 USDT = 1 USD; a unique number of cents (0.01–0.99) is added so each payment matches exactly one request, and that exact amount is credited → member sees the admin's TRON address, network **TRON (TRC20)**, a QR code (the address), copy buttons and a prominent warning to send **only USDT on TRC20** (ERC20/BEP20 or other tokens are lost) → TXID → **I've paid** → *Pending review*. |
| BTC deposit | Member enters a USD amount → server fetches the BTC/USD price (mempool.space + Coinbase, must agree within 2 %) → member sees the admin's Mainnet address, the **exact** BTC amount, a QR code and instructions → after paying, enters the TXID and presses **I've paid** → status *Under review*; admins are notified. **The balance does not change.** |
| Admin review | Admin checks the TXID on the request's own blockchain. **BTC**: mempool.space + blockstream.info — right address, exact satoshi amount, paid within the quote window, enough confirmations (default 2), both explorers agree. **USDT TRC20**: TronGrid full node + solidity node — transaction succeeded, a `Transfer` event of the **official USDT contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`** (fake tokens rejected), exact amount to the request's address, within the quote window, ≥ 20 confirmations and solidified (irreversible). Only then can the admin approve (confirmation screen with member, method, amount, TXID); the balance is credited once, atomically. Or rejected with a reason. The member is notified either way. |
| Transfers | Recipient's 8-digit account number → masked name shown for confirmation → confirm. Atomic, row-locked, idempotent (a retry or double click never sends twice), unique `TRF…` reference, both sides get a history entry and a notification. |
| History | Reference, type, amount, date, status and description for deposits, transfers sent/received (withdrawals are prepared as a type, the feature is "coming soon"). |
| Admin panel | `/admin`: notifications (new requests highlighted, read/unread, auto-refresh every 10 s, pending count in the tab title), **Payment requests** (BTC + USDT TRC20; filter by method and by All / Pending / Approved / Rejected / Awaiting payment) with **APPROVE / REJECT** on every pending row, request details with blockchain check, all transactions, **Payment methods** (one card per method: add/change the address, last update date and admin, **Active/Inactive**), **Audit log**. Counters: new, pending, approved, rejected payments (per method). Members get a 404. |
| Manual review | Nothing is approved or rejected automatically and requests never expire. A request stays **pending** until an admin presses APPROVE (only possible after the payment is verified on its blockchain) or REJECT (with a reason). A late payment is shown to the admin as a warning, not a rejection. |
| Sound alerts | The admin panel checks for new requests every 5 s (15 s in a background tab) and plays a chime once per new "I've paid" request; new requests are highlighted (**NEW PAYMENT REQUEST**, *Mark as seen*). On/off and volume per browser; if the browser blocks audio, the panel asks for a click. (Vercel has no WebSocket server and the browser never talks to the database directly, so polling is used.) |
| Audit log | Every admin action — address changes per method (old → new), enabling/disabling a payment method, approvals (method, TXID, confirmations), rejections (reason) — is stored in `admin_audit_log` with the admin and time. |

## How it is secured

- The browser never talks to Supabase. The Next.js server calls database functions (RPC).
- **Anon / publishable key** (public): can only call `igw_*` functions that check the session token themselves. Every table has RLS on, no policies, and no grants for `anon` / `authenticated`.
- **Service role key** (secret, server-only): required for the three functions that take trusted input from the server — `igw_deposit_create` (BTC price / USDT rate), `igw_admin_approve` (blockchain verification), `igw_admin_set_deposit_address`. With only the public key nobody can choose a price or fake an approval.
- Admin rights come from the `public.admin_roles` table, which only the database owner can change (SQL Editor). Not from usernames or emails.
- Each open deposit request has a unique amount per method (satoshis / USDT cents), so a payment matches exactly one request; every TXID can be claimed once across both methods; a request keeps the address it was shown even if the admin changes the address later.
- Sessions: random token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie; only its SHA-256 hash is stored; 7-day idle / 30-day absolute expiry. Passwords: bcrypt. Sign-in throttled (5 failures / 15 min).
- No secrets or personal data are written to logs.

## Setup

1. **Database** — in the Supabase SQL Editor of the project your site uses, run the whole [`supabase/schema.sql`](supabase/schema.sql) (fresh or existing project; idempotent; keeps existing balances). Projects that already ran an earlier version can instead run, in order, only the migrations they have not run yet (the result is identical): [`20261120000000_auth_hardening.sql`](supabase/migrations/20261120000000_auth_hardening.sql), [`20261120000100_wallet_btc_transfers.sql`](supabase/migrations/20261120000100_wallet_btc_transfers.sql), [`20261120000200_btc_settings_audit.sql`](supabase/migrations/20261120000200_btc_settings_audit.sql) (payment method on/off, member name on requests, audit log), [`20261120000300_usdt_trc20.sql`](supabase/migrations/20261120000300_usdt_trc20.sql) (USDT TRC20; existing requests become method `btc` and keep all their data), [`20261120000400_manual_review.sql`](supabase/migrations/20261120000400_manual_review.sql) (manual review only, sound alerts). **If unsure which ones ran, run the whole `schema.sql`.**
2. **Environment variables** (Vercel → Settings → Environment Variables), all from the same Supabase project:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<service_role or sb_secret_ key>   # secret, server-only
   TRONGRID_API_KEY=<optional, from trongrid.io>                 # secret, server-only; higher rate limit for USDT checks
   ```

   Redeploy afterwards (`NEXT_PUBLIC_*` values are baked in at build time).
3. **Admin account** (no password is stored in code):
   1. Sign up on the website with the admin's email address and a strong password.
   2. In the SQL Editor run: `select igw_private.grant_admin('admin-email@example.com', 'enkyryyss');`
   3. Sign in with the email or the username `enkyryyss`; the **Admin panel** link appears in the sidebar.
   To remove: `select igw_private.revoke_admin('admin-email@example.com');`
4. **Deposit addresses** — in `/admin` → **Payment methods**:
   - **Bitcoin (BTC)**: your Bitcoin **Mainnet** address (`bc1…`, `1…` or `3…`; checksum verified, testnet refused).
   - **Tether (USDT TRC20)**: your **TRON** wallet address that can receive USDT TRC20 (`T…`, 34 characters; Base58Check verified; the USDT contract address itself is refused).
   Until an address is set, members see "… deposits are not available yet" for that method.
5. Open `/api/health`: expect `{"ok":true,"supabase":"ok","schema":"igw-rpc-6","schemaOk":true,"serviceKey":"configured",…}`. The admin panel (Payment methods) shows the same checks in a **System status** card, and a red banner on every admin page if the database version or the service key is wrong.

Defaults (change in the SQL Editor, table `public.app_settings`): BTC 2 confirmations, USDT TRC20 20 confirmations (+ solidified), min 10 USD, max 10,000 USD, payment window 60 minutes.

## Database

Tables: `profiles` (+ `account_number`, `username`), `wallets`, `transactions` (+ `reference`, `status`, `description`), `deposit_requests` (+ `user_name`, `method`, `amount_units`, `usd_rate`, `deposit_address`), `transfers`, `notifications`, `admin_roles`, `admin_audit_log`, `app_settings` (incl. `btc_address`, `btc_deposits_enabled`, `usdt_trc20_address`, `usdt_trc20_deposits_enabled`), `sessions`, `login_attempts`, `transfer_lookups`. Legacy demo tables `cards`, `recipients`, `exchange_rates` are kept (unused) so no data is lost; non-USD demo wallets are kept but hidden.

## Not included (needs your decision / services)

- **Withdrawals**: prepared as a transaction type, the button shows "soon". Paying out BTC/USDT needs a custody/payout process.
- **Email notifications**: notifications are in-app (dashboard and admin panel). Email would need an email-sending service.
- **Automatic crediting**: intentionally not used — every payment is approved manually by an admin.
- **Per-user deposit addresses**: all members pay to one admin address per method; unique amounts tell payments apart. Per-user addresses need an xpub/HD wallet setup.
- Holding and transferring customer funds may require licences (e.g. money transmission, KYC/AML) depending on your jurisdiction.

## Local development

```bash
cp .env.example .env.local   # fill in the three Supabase values
npm install
npm run dev
```
