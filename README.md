# Insta Global Wallet

Multi-user USD wallet built with Next.js App Router and Supabase: account numbers like `UK1234567 12345`, **Bitcoin (BTC)** and **Tether USDT (TRC20)** deposits approved manually by an admin, member-to-member transfers, notifications and an admin panel. Deployable to Vercel.

## Features

| Area | What it does |
| --- | --- |
| Account number | Every member gets a random, unique, permanent number at sign-up: **UK + 12 digits**, shown as 7 + 5 digits — `UK1234567 12345` (stored without the space: `UK123456712345`). Shown with a copy button on the dashboard and profile. A database trigger forbids changing it. Members who joined with an old 8-digit number got a new number (migration 0900); the old number is kept (`profiles.previous_account_number`) and still works for transfers and the admin member search. |
| Balance | One USD balance per member, starting at **0.00**. It changes only inside database functions (approved deposits, transfers). Balances can never go negative. |
| Payment methods | Two methods, each with its own address (stored in the database, set by the admin — never in code) and its own Active/Inactive switch: **Bitcoin (BTC)** on Bitcoin Mainnet and **Tether (USDT TRC20)** on the TRON network. The member picks one on the deposit screen. |
| USDT TRC20 deposit | Member enters a USD amount → 1 USDT = 1 USD; a unique number of cents (0.01–0.99) is added so each payment matches exactly one request, and that exact amount is credited → member sees the admin's TRON address, network **TRON (TRC20)**, a QR code (the address), copy buttons and a prominent warning to send **only USDT on TRC20** (ERC20/BEP20 or other tokens are lost) → TXID → **I've paid** → *Pending review*. |
| BTC deposit | Member enters a USD amount → server fetches the BTC/USD price (mempool.space + Coinbase, must agree within 2 %) → member sees the admin's Mainnet address, the **exact** BTC amount, a QR code and instructions → after paying, enters the TXID and presses **I've paid** → status *Under review*; admins are notified. **The balance does not change.** |
| Admin review | There is **no automatic blockchain verification** (no blockchain APIs). The admin checks in their own wallet (or via the Tronscan / mempool.space link in the request) that the payment arrived, then presses **APPROVE** — this completes the payment: balance credited once, atomically; transaction completed; member notified; audit log entry. Optionally a lower amount can be credited if less arrived. Or **REJECT** with a reason. |
| Transfers | Recipient's account number (spaces, dashes and lower case are accepted: `uk1234567 12345`) → masked name shown for confirmation → confirm. Atomic, row-locked, idempotent (a retry or double click never sends twice), unique `TRF…` reference, both sides get a history entry and a notification. |
| History | Reference, type, amount, date, status and description for deposits, transfers sent/received (withdrawals are prepared as a type, the feature is "coming soon"). |
| Admin panel | `/admin`: notifications (new requests highlighted, read/unread, auto-refresh every 10 s, pending count in the tab title), **Payment requests** (BTC + USDT TRC20; filter by method and by All / Pending / Approved / Rejected / Awaiting payment) with **APPROVE / REJECT** on every pending row, request details with blockchain check, all transactions, **Payment methods** (one card per method: add/change the address, last update date and admin, **Active/Inactive**), **Audit log**. Counters: new, pending, approved, rejected payments (per method). Members get a 404. |
| Manual approval | APPROVE is available on every pending ("I've paid") request and needs only an admin session. Safeguards: admins only (checked in the database), a request can be approved once (row lock), every TXID can be used once, never more than the requested amount, full audit log. **The balance is only as reliable as the admin's check: approve only after the payment is visible in your wallet.** |
| Cards | A member needs an **active card** to withdraw. The member requests a card (Standard, Gold, Premium or Merchant — **no fee**); an admin activates, changes or deactivates it (Admin → Cards). Daily withdrawal limits over the last 24 h: Standard 750, Gold 1,250, Premium 5,000 USD, Merchant unlimited (`app_settings.card_limit_*`). The card shows the member's **name**, the last 4 digits and **VALID THRU** (3 years from activation; an expired card cannot be used to withdraw until the admin renews it — re-activation or an approved renewal request). There is deliberately **no CVV / full card number**: these are membership cards for withdrawals on this site, not payment cards. The member's name is also shown above the balance. |
| Identity verification (KYC) | A card request needs identity documents: **front and back photos** of an ID card, driving licence or passport, plus a consent checkbox. The browser shrinks each photo (max 1800 px, JPEG, ≤ 2 MB — this also removes EXIF/GPS data); the server checks the real file type from its bytes and stores the photos in the **private Supabase Storage bucket `kyc-documents`** (created by `schema.sql`, not public, no storage policies — only the server with `SUPABASE_SERVICE_ROLE_KEY` can read/write). Admin → **Identity (KYC)** shows the photos (streamed through `/api/admin/kyc-file` after an admin check, never cached, no public URL) with Verify / Reject (reason sent to the member; rejecting also closes the waiting card request). A card can only be activated for a verified member; activating a card request also verifies its pending documents. Admin → Payment methods → System status checks that the bucket exists and is private. |
| Members & passwords | Admin → **Members**: search by name, email, username or account number (also an old 8-digit one); member detail with balance, card, identity documents, last activity, transactions and requests. Passwords are never shown (only bcrypt hashes are stored). **Reset password** creates a random 12-character temporary password shown to the admin once (copy button + ready-made WhatsApp message); all of the member's sessions end, and after signing in the member must choose a new password before anything else (enforced in the database, SQLSTATE PT428 → HTTP 428). Admin passwords cannot be reset there. Members change their own password in the dashboard (menu **Password**); other devices are signed out. The sign-in page has **Forgot password?** and **Change / reset password via WhatsApp**: they open a WhatsApp chat with the support number from Contact details, with the typed email prefilled. |
| Contact details | Admin → **Contact details**: email, phone, WhatsApp, Telegram, address, support hours (stored in `app_settings.contact_*`, validated, audit-logged). Shown in a **Contact** section on the homepage (hidden while empty) and in a **Contact support** card on the member dashboard. |
| Withdrawals | Member enters a Bitcoin mainnet address and a USD amount (checksum, minimum, balance and card limit checked in the database under a row lock). The amount is reserved from the balance at once. Admin → Withdrawals: **APPROVE** = the admin sent the BTC from the company wallet (TXID optional, shown to the member) or **REJECT** with a reason (amount returned). The member can cancel a pending request. Notifications, audit log and the admin sound alert cover withdrawals and card requests too. |
| Manual review | Nothing is approved or rejected automatically and requests never expire. A request stays **pending** until an admin approves or rejects it. |
| Sound alerts | The admin panel checks for new requests every 5 s (15 s in a background tab) and plays a chime once per new "I've paid" request; new requests are highlighted (**NEW PAYMENT REQUEST**, *Mark as seen*). On/off and volume per browser; if the browser blocks audio, the panel asks for a click. (Vercel has no WebSocket server and the browser never talks to the database directly, so polling is used.) |
| Audit log | Every admin action — address changes per method (old → new), enabling/disabling a payment method, approvals (method, TXID, requested and credited amount), rejections (reason) — is stored in `admin_audit_log` with the admin and time. |

## How it is secured

- The browser never talks to Supabase. The Next.js server calls database functions (RPC).
- **Anon / publishable key** (public): can only call `igw_*` functions that check the session token themselves. Every table has RLS on, no policies, and no grants for `anon` / `authenticated`.
- **Service role key** (secret, server-only): required for `igw_deposit_create` (the BTC price comes from the server, so nobody can choose the rate). Approving payments and saving addresses need only an admin session.
- Admin rights come from the `public.admin_roles` table, which only the database owner can change (SQL Editor). Not from usernames or emails.
- Each open deposit request has a unique amount per method (satoshis / USDT cents), so a payment matches exactly one request; every TXID can be claimed once across both methods; a request keeps the address it was shown even if the admin changes the address later.
- Sessions: random token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie; only its SHA-256 hash is stored; 7-day idle / 30-day absolute expiry. Passwords: bcrypt. Sign-in throttled (5 failures / 15 min).
- No secrets or personal data are written to logs.

## Setup

1. **Database** — in the Supabase SQL Editor of the project your site uses, run the whole [`supabase/schema.sql`](supabase/schema.sql) (fresh or existing project; idempotent; keeps existing balances). Projects that already ran an earlier version can instead run, in order, only the migrations they have not run yet (the result is identical): [`20261120000000_auth_hardening.sql`](supabase/migrations/20261120000000_auth_hardening.sql), [`20261120000100_wallet_btc_transfers.sql`](supabase/migrations/20261120000100_wallet_btc_transfers.sql), [`20261120000200_btc_settings_audit.sql`](supabase/migrations/20261120000200_btc_settings_audit.sql) (payment method on/off, member name on requests, audit log), [`20261120000300_usdt_trc20.sql`](supabase/migrations/20261120000300_usdt_trc20.sql) (USDT TRC20; existing requests become method `btc` and keep all their data), [`20261120000400_manual_review.sql`](supabase/migrations/20261120000400_manual_review.sql) (manual review only, sound alerts), [`20261120000500_manual_approval.sql`](supabase/migrations/20261120000500_manual_approval.sql) (approving a real payment of a different amount), [`20261120000600_admin_approval_only.sql`](supabase/migrations/20261120000600_admin_approval_only.sql) (no blockchain verification; the admin's approval completes the payment), [`20261120000700_cards_withdrawals.sql`](supabase/migrations/20261120000700_cards_withdrawals.sql) (cards and Bitcoin withdrawals), [`20261120000800_card_validity_contact.sql`](supabase/migrations/20261120000800_card_validity_contact.sql) (card holder name + valid thru, contact details), [`20261120000900_account_number_format.sql`](supabase/migrations/20261120000900_account_number_format.sql) (account numbers `UK1234567 12345`), [`20261121001000_kyc.sql`](supabase/migrations/20261121001000_kyc.sql) (identity verification), [`20261124001100_members_passwords.sql`](supabase/migrations/20261124001100_members_passwords.sql) (member directory, password reset/change). **If unsure which ones ran, run the whole `schema.sql`.**
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
4. **Deposit addresses** — in `/admin` → **Payment methods**:
   - **Bitcoin (BTC)**: your Bitcoin **Mainnet** address (`bc1…`, `1…` or `3…`; checksum verified, testnet refused).
   - **Tether (USDT TRC20)**: your **TRON** wallet address that can receive USDT TRC20 (`T…`, 34 characters; Base58Check verified; the USDT contract address itself is refused).
   Until an address is set, members see "… deposits are not available yet" for that method.
5. Open `/api/health`: expect `{"ok":true,"supabase":"ok","schema":"igw-rpc-13","schemaOk":true,"serviceKey":"configured",…}`. The admin panel (Payment methods) shows the same checks in a **System status** card, and a red banner on every admin page if the database version or the service key is wrong.

Defaults (change in the SQL Editor, table `public.app_settings`): min 10 USD, max 10,000 USD per request.

## Database

Tables: `profiles` (+ `account_number`, `username`), `wallets`, `transactions` (+ `reference`, `status`, `description`), `deposit_requests` (+ `user_name`, `method`, `amount_units`, `usd_rate`, `deposit_address`), `transfers`, `notifications`, `admin_roles`, `admin_audit_log`, `app_settings` (incl. `btc_address`, `btc_deposits_enabled`, `usdt_trc20_address`, `usdt_trc20_deposits_enabled`), `sessions`, `login_attempts`, `transfer_lookups`. Legacy demo tables `cards`, `recipients`, `exchange_rates` are kept (unused) so no data is lost; non-USD demo wallets are kept but hidden.

## Not included (needs your decision / services)

- **Automatic payouts**: withdrawals are paid manually by the admin from the company wallet; the site does not hold or send crypto itself.
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
