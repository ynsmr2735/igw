-- Migration 2026-11-20 (9): card holder name + valid thru, contact details (igw-rpc-9 -> igw-rpc-10).
--
-- * member_cards.valid_until: 3 years from (re)activation; an expired card cannot be used
--   to withdraw until an admin re-activates it. Existing cards: activation date + 3 years.
-- * Contact details (email, phone, WhatsApp, Telegram, address, hours) in app_settings:
--   public read (igw_contact_info), admin update (igw_admin_set_contact, validated, audited).
-- For projects that already ran 20261120000700_cards_withdrawals.sql. Running the full,
-- idempotent supabase/schema.sql has the same effect from ANY earlier version.
-- Existing balances, requests and transactions are kept.

-- ---------------------------------------------------------------------------
-- Wallet: 8-digit account numbers, BTC deposits, transfers, notifications,
-- admin roles (schema igw-rpc-3)
-- ---------------------------------------------------------------------------

-- Permanent 8-digit account number, optional login username (admins).
alter table public.profiles add column if not exists account_number text;
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_account_number_key on public.profiles(account_number);
create unique index if not exists profiles_username_key on public.profiles(lower(username)) where username is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_account_number_format') then
    alter table public.profiles add constraint profiles_account_number_format
      check (account_number ~ '^[1-9][0-9]{7}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_username_format') then
    alter table public.profiles add constraint profiles_username_format
      check (username ~ '^[a-z0-9_.]{3,32}$');
  end if;
end;
$$;

-- One active USD balance per user; balances can never go negative.
alter table public.wallets add column if not exists is_active boolean not null default true;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wallets_balance_nonnegative') then
    alter table public.wallets add constraint wallets_balance_nonnegative check (balance >= 0);
  end if;
end;
$$;
create unique index if not exists wallets_one_usd_per_user on public.wallets(user_id) where currency = 'USD';

-- Roles live in their own table; only the database owner (SQL Editor) can change them.
create table if not exists public.admin_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin')),
  granted_at timestamptz not null default now(),
  granted_by text not null default current_user
);

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.app_settings (key, value) values
  ('btc_network', 'mainnet'),
  ('btc_required_confirmations', '2'),
  ('deposit_min_usd', '10'),
  ('deposit_max_usd', '10000'),
  ('deposit_quote_minutes', '60')
on conflict (key) do nothing;

create table if not exists public.deposit_requests (
  id bigint generated always as identity primary key,
  reference text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_number text not null,
  method text not null default 'btc',
  amount_usd numeric(14, 2) not null check (amount_usd > 0),
  usd_rate numeric(16, 2) not null check (usd_rate > 0),
  rate_source text not null,
  amount_units bigint not null check (amount_units > 0),
  deposit_address text not null,
  network text not null default 'mainnet',
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'reviewing', 'approved', 'rejected', 'expired', 'cancelled')),
  txid text check (txid ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  rejection_reason text,
  verification jsonb,
  created_at timestamptz not null default now()
);
-- igw-rpc-5: BTC-specific columns become generic for every payment method
-- (renamed in place, so existing requests keep all their data).
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'deposit_requests' and column_name = 'amount_sats') then
    alter table public.deposit_requests rename column amount_sats to amount_units;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'deposit_requests' and column_name = 'btc_usd_rate') then
    alter table public.deposit_requests rename column btc_usd_rate to usd_rate;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'deposit_requests' and column_name = 'btc_address') then
    alter table public.deposit_requests rename column btc_address to deposit_address;
  end if;
  if exists (select 1 from pg_constraint where conname = 'deposit_requests_amount_sats_check') then
    alter table public.deposit_requests rename constraint deposit_requests_amount_sats_check to deposit_requests_amount_units_check;
  end if;
  if exists (select 1 from pg_constraint where conname = 'deposit_requests_btc_usd_rate_check') then
    alter table public.deposit_requests rename constraint deposit_requests_btc_usd_rate_check to deposit_requests_usd_rate_check;
  end if;
end;
$$;
alter table public.deposit_requests add column if not exists method text not null default 'btc';
-- igw-rpc-7: amount actually credited (can differ from amount_usd when the admin
-- approves a real payment of a different amount).
alter table public.deposit_requests add column if not exists credited_usd numeric(14, 2);
update public.deposit_requests set credited_usd = amount_usd where status = 'approved' and credited_usd is null;
alter table public.deposit_requests drop constraint if exists deposit_requests_network_check;
alter table public.deposit_requests drop constraint if exists deposit_requests_method_check;
alter table public.deposit_requests add constraint deposit_requests_method_check
  check ((method = 'btc' and network = 'mainnet') or (method = 'usdt_trc20' and network = 'tron'));

-- At most one open request per user, every TXID claimed once, and each open
-- request of a method has a unique amount (so nobody can claim someone else's payment).
create unique index if not exists deposit_requests_one_open_per_user
  on public.deposit_requests(user_id) where status in ('awaiting_payment', 'reviewing');
create unique index if not exists deposit_requests_txid_key
  on public.deposit_requests(txid) where txid is not null;
drop index if exists public.deposit_requests_open_sats_key;
create unique index if not exists deposit_requests_open_amount_key
  on public.deposit_requests(method, amount_units) where status in ('awaiting_payment', 'reviewing');
create index if not exists deposit_requests_status_idx on public.deposit_requests(status, created_at desc);
create index if not exists deposit_requests_user_idx on public.deposit_requests(user_id, created_at desc);

create table if not exists public.transfers (
  id bigint generated always as identity primary key,
  reference text not null unique,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  note text not null default '',
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint transfers_idempotency_key unique (sender_id, idempotency_key),
  constraint transfers_not_self check (sender_id <> recipient_id)
);
create index if not exists transfers_recipient_idx on public.transfers(recipient_id, created_at desc);

create table if not exists public.transfer_lookups (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  looked_up_at timestamptz not null default now()
);
create index if not exists transfer_lookups_user_idx on public.transfer_lookups(user_id, looked_up_at);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications(user_id) where read_at is null;

-- Transaction history: reference number, status and description for every entry.
alter table public.transactions add column if not exists reference text;
alter table public.transactions add column if not exists description text not null default '';
alter table public.transactions add column if not exists counterparty_account text;
alter table public.transactions add column if not exists deposit_request_id bigint;
alter table public.transactions add column if not exists transfer_id bigint;
create unique index if not exists transactions_wallet_reference_key on public.transactions(wallet_id, reference);
create index if not exists transactions_deposit_idx on public.transactions(deposit_request_id) where deposit_request_id is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_status_check') then
    alter table public.transactions add constraint transactions_status_check
      check (status in ('pending', 'completed', 'failed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_deposit_fkey') then
    alter table public.transactions add constraint transactions_deposit_fkey
      foreign key (deposit_request_id) references public.deposit_requests(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_transfer_fkey') then
    alter table public.transactions add constraint transactions_transfer_fkey
      foreign key (transfer_id) references public.transfers(id) on delete set null;
  end if;
end;
$$;

-- BTC payment method switch, managed in the admin panel (igw-rpc-4).
insert into public.app_settings (key, value) values ('btc_deposits_enabled', 'true')
on conflict (key) do nothing;

-- Member's name at the time of the request.
alter table public.deposit_requests add column if not exists user_name text;
update public.deposit_requests d
set user_name = p.full_name
from public.profiles p
where p.id = d.user_id and d.user_name is null;

-- Audit trail: every admin action (address changes, enable/disable, approvals,
-- rejections) is recorded here. The app only ever inserts into this table.
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles(id) on delete set null,
  admin_label text not null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_time_idx on public.admin_audit_log(created_at desc);

-- USDT TRC20 payment method (igw-rpc-5). The address is set by the admin.
insert into public.app_settings (key, value) values
  ('usdt_trc20_deposits_enabled', 'true'),
  ('usdt_trc20_required_confirmations', '20')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Cards and crypto withdrawals (igw-rpc-9)
-- A member can request withdrawals only with an ACTIVE card. Cards are activated,
-- changed and deactivated by an admin (no fee). Each tier has a daily (24 h) limit.
-- ---------------------------------------------------------------------------
create table if not exists public.member_cards (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  card_number text not null unique,
  tier text not null check (tier in ('standard', 'gold', 'premium', 'merchant')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  activated_at timestamptz,
  activated_by uuid references public.profiles(id) on delete set null,
  deactivated_at timestamptz,
  deactivated_by uuid references public.profiles(id) on delete set null,
  deactivation_reason text,
  updated_at timestamptz not null default now()
);

create table if not exists public.card_requests (
  id bigint generated always as identity primary key,
  reference text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_number text not null,
  user_name text not null,
  tier text not null check (tier in ('standard', 'gold', 'premium', 'merchant')),
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  rejection_reason text
);
create unique index if not exists card_requests_one_pending on public.card_requests(user_id) where status = 'pending';
create index if not exists card_requests_status_idx on public.card_requests(status, created_at desc);

create table if not exists public.withdrawal_requests (
  id bigint generated always as identity primary key,
  reference text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_number text not null,
  user_name text not null,
  amount_usd numeric(14, 2) not null check (amount_usd > 0),
  method text not null default 'btc' check (method = 'btc'),
  btc_address text not null,
  card_tier text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  txid text check (txid ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  rejection_reason text
);
create index if not exists withdrawal_requests_user_idx on public.withdrawal_requests(user_id, created_at desc);
create index if not exists withdrawal_requests_status_idx on public.withdrawal_requests(status, created_at desc);

alter table public.transactions add column if not exists withdrawal_request_id bigint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_withdrawal_fkey') then
    alter table public.transactions add constraint transactions_withdrawal_fkey
      foreign key (withdrawal_request_id) references public.withdrawal_requests(id) on delete set null;
  end if;
end;
$$;

insert into public.app_settings (key, value) values
  ('card_limit_standard', '750'),
  ('card_limit_gold', '1250'),
  ('card_limit_premium', '5000'),
  ('card_limit_merchant', 'unlimited'),
  ('withdrawal_min_usd', '10')
on conflict (key) do nothing;

-- igw-rpc-10: card validity ("VALID THRU"): 3 years from (re)activation.
alter table public.member_cards add column if not exists valid_until timestamptz;
update public.member_cards set valid_until = coalesce(activated_at, updated_at, now()) + interval '3 years' where valid_until is null;

-- igw-rpc-10: contact details shown on the website (edited by an admin).
insert into public.app_settings (key, value) values
  ('contact_email', ''), ('contact_phone', ''), ('contact_whatsapp', ''),
  ('contact_telegram', ''), ('contact_address', ''), ('contact_hours', '')
on conflict (key) do nothing;

alter table public.member_cards enable row level security;
alter table public.card_requests enable row level security;
alter table public.withdrawal_requests enable row level security;
revoke all on public.member_cards, public.card_requests, public.withdrawal_requests from public, anon, authenticated;

alter table public.admin_roles enable row level security;
alter table public.app_settings enable row level security;
alter table public.deposit_requests enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_lookups enable row level security;
alter table public.notifications enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_roles, public.app_settings, public.deposit_requests, public.transfers, public.transfer_lookups, public.notifications, public.admin_audit_log
  from public, anon, authenticated;

create sequence if not exists igw_private.reference_seq;

-- Unique, human-readable reference: <PREFIX><YYMMDD><8-digit sequence>, e.g. TRF26112000000042.
create or replace function igw_private.new_reference(p_prefix text)
returns text
language sql
volatile
security definer
set search_path = public, extensions
as $$
  select p_prefix || to_char(now() at time zone 'utc', 'YYMMDD')
         || lpad(nextval('igw_private.reference_seq')::text, 8, '0');
$$;

-- Random 8-digit account number (10000000–99999999) not used by anyone yet.
-- The unique index on profiles.account_number is the final guarantee.
create or replace function igw_private.new_account_number()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_number text;
begin
  loop
    v_number := (10000000 + floor(random() * 90000000))::bigint::text;
    exit when not exists (select 1 from public.profiles where account_number = v_number);
  end loop;
  return v_number;
end;
$$;

create or replace function igw_private.lock_account_number()
returns trigger
language plpgsql
as $$
begin
  if old.account_number is not null and new.account_number is distinct from old.account_number then
    raise exception 'Account numbers are permanent and cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function igw_private.setting(p_key text)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select value from public.app_settings where key = p_key;
$$;

create or replace function igw_private.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (select 1 from public.admin_roles where user_id = p_user_id and role = 'admin');
$$;

-- Signed-in user or SQLSTATE 28000 (the app turns it into HTTP 401).
create or replace function igw_private.require_user(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.touch_session(p_token);
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'You must be signed in';
  end if;
  return v_uid;
end;
$$;

-- Signed-in admin, or SQLSTATE PT403 (HTTP 403). Checked against admin_roles, never a username.
create or replace function igw_private.require_admin(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
begin
  if not igw_private.is_admin(v_uid) then
    raise exception using errcode = 'PT403', message = 'Admin access required';
  end if;
  return v_uid;
end;
$$;

create or replace function igw_private.audit(
  p_admin uuid, p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.admin_audit_log (admin_id, admin_label, action, target_type, target_id, details)
  select p_admin,
         coalesce((select coalesce(username, email) from public.profiles where id = p_admin), 'system'),
         p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb);
$$;

create or replace function igw_private.notify(
  p_user_id uuid, p_kind text, p_title text, p_body text, p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.notifications (user_id, kind, title, body, data)
  values (p_user_id, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb));
$$;

create or replace function igw_private.notify_admins(
  p_kind text, p_title text, p_body text, p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.notifications (user_id, kind, title, body, data)
  select user_id, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb)
  from public.admin_roles
  where role = 'admin';
$$;

-- "Ayşe Yılmaz" -> "Ay** Yı****": enough to confirm a recipient, not to identify a stranger.
create or replace function igw_private.mask_name(p_name text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(
    case when length(part) <= 2 then left(part, 1) || '*'
         else left(part, 2) || repeat('*', length(part) - 2) end,
    ' ' order by n), '')
  from regexp_split_to_table(trim(coalesce(p_name, '')), '\s+') with ordinality as t(part, n)
  where part <> '';
$$;

create or replace function igw_private.format_btc(p_sats bigint)
returns text
language sql
immutable
as $$
  select to_char(p_sats / 100000000.0, 'FM9999990.00000000');
$$;

-- Display amount: BTC with 8 decimals, USDT with 2 (amounts are whole cents).
create or replace function igw_private.format_units(p_method text, p_units bigint)
returns text
language sql
immutable
as $$
  select case p_method
    when 'usdt_trc20' then to_char(p_units / 1000000.0, 'FM999999999990.00')
    else to_char(p_units / 100000000.0, 'FM9999990.00000000')
  end;
$$;

create or replace function igw_private.method_asset(p_method text)
returns text
language sql
immutable
as $$
  select case p_method when 'usdt_trc20' then 'USDT' else 'BTC' end;
$$;

-- Settings keys per payment method.
-- Base58Check decode: payload (without the 4-byte checksum) or null if invalid.
create or replace function igw_private.base58check_payload(p_text text)
returns bytea
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_alphabet constant text := '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  v_num numeric := 0;
  v_idx integer;
  v_hex text := '';
  v_raw bytea;
  v_len integer;
  i integer;
begin
  if p_text is null or p_text = '' or length(p_text) > 64 then
    return null;
  end if;
  for i in 1..length(p_text) loop
    v_idx := strpos(v_alphabet, substr(p_text, i, 1)) - 1;
    if v_idx < 0 then
      return null;
    end if;
    v_num := v_num * 58 + v_idx;
  end loop;
  while v_num > 0 loop
    v_hex := lpad(to_hex(mod(v_num, 256)::integer), 2, '0') || v_hex;
    v_num := div(v_num, 256);
  end loop;
  i := 1;
  while i <= length(p_text) and substr(p_text, i, 1) = '1' loop
    v_hex := '00' || v_hex;
    i := i + 1;
  end loop;
  v_raw := decode(v_hex, 'hex');
  v_len := length(v_raw);
  if v_len < 5 then
    return null;
  end if;
  if substring(extensions.digest(extensions.digest(substring(v_raw from 1 for v_len - 4), 'sha256'), 'sha256') from 1 for 4)
     <> substring(v_raw from v_len - 3 for 4) then
    return null;
  end if;
  return substring(v_raw from 1 for v_len - 4);
end;
$$;

-- Bech32 (BIP173, segwit v0) / Bech32m (BIP350, v1+) mainnet address check.
create or replace function igw_private.bech32_valid(p_address text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_charset constant text := 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  v_gen constant bigint[] := array[996825010, 642813549, 513874426, 1027748829, 705979059];
  v_addr text := lower(p_address);
  v_data integer[] := '{}';
  v_values integer[];
  v_chk bigint := 1;
  v_top bigint;
  v_v integer;
  v_version integer;
  v_prog_len integer;
  i integer;
  j integer;
begin
  if p_address is null or p_address <> v_addr and p_address <> upper(p_address) then
    return false; -- mixed case is invalid
  end if;
  if v_addr !~ '^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{11,87}$' then
    return false;
  end if;
  for i in 4..length(v_addr) loop
    v_data := v_data || (strpos(v_charset, substr(v_addr, i, 1)) - 1);
  end loop;
  -- hrp_expand('bc') = [3, 3, 0, 2, 3]
  v_values := array[3, 3, 0, 2, 3] || v_data;
  foreach v_v in array v_values loop
    v_top := v_chk >> 25;
    v_chk := ((v_chk & 33554431) << 5) # v_v;
    for j in 0..4 loop
      if ((v_top >> j) & 1) = 1 then
        v_chk := v_chk # v_gen[j + 1];
      end if;
    end loop;
  end loop;
  v_version := v_data[1];
  if v_version > 16 then
    return false;
  end if;
  if (v_version = 0 and v_chk <> 1) or (v_version > 0 and v_chk <> 734539939) then
    return false;
  end if;
  -- witness program length in bytes (5-bit groups without version and 6 checksum chars)
  v_prog_len := ((array_length(v_data, 1) - 7) * 5) / 8;
  if v_prog_len < 2 or v_prog_len > 40 or (v_version = 0 and v_prog_len not in (20, 32)) then
    return false;
  end if;
  return true;
end;
$$;

-- Full address validation per payment method (mainnet only).
create or replace function igw_private.deposit_address_valid(p_method text, p_address text)
returns boolean
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_payload bytea;
begin
  if p_address is null or p_address = '' then
    return false;
  end if;
  if p_method = 'usdt_trc20' then
    if p_address !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then
      return false;
    end if;
    v_payload := igw_private.base58check_payload(p_address);
    return v_payload is not null and length(v_payload) = 21 and get_byte(v_payload, 0) = 65; -- 0x41
  elsif p_method = 'btc' then
    if lower(left(p_address, 3)) = 'bc1' then
      return igw_private.bech32_valid(p_address);
    end if;
    if p_address !~ '^[13][1-9A-HJ-NP-Za-km-z]{25,34}$' then
      return false;
    end if;
    v_payload := igw_private.base58check_payload(p_address);
    return v_payload is not null and length(v_payload) = 21 and get_byte(v_payload, 0) in (0, 5);
  end if;
  return false;
end;
$$;

create or replace function igw_private.method_key(p_method text, p_what text)
returns text
language sql
immutable
as $$
  select case p_method
    when 'btc' then case p_what when 'address' then 'btc_address' when 'enabled' then 'btc_deposits_enabled'
                                when 'confirmations' then 'btc_required_confirmations' end
    when 'usdt_trc20' then case p_what when 'address' then 'usdt_trc20_address' when 'enabled' then 'usdt_trc20_deposits_enabled'
                                       when 'confirmations' then 'usdt_trc20_required_confirmations' end
  end;
$$;

create or replace function igw_private.method_config(p_method text)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'method', p_method,
    'asset', igw_private.method_asset(p_method),
    'name', case p_method when 'usdt_trc20' then 'Tether (USDT TRC20)' else 'Bitcoin (BTC)' end,
    'network', case p_method when 'usdt_trc20' then 'tron' else 'mainnet' end,
    'networkLabel', case p_method when 'usdt_trc20' then 'TRON (TRC20)' else 'Bitcoin Mainnet' end,
    'enabled', coalesce(igw_private.setting(igw_private.method_key(p_method, 'enabled')), 'true') = 'true',
    'address', igw_private.setting(igw_private.method_key(p_method, 'address')),
    'addressUpdatedAt', (select updated_at from public.app_settings where key = igw_private.method_key(p_method, 'address')),
    'addressUpdatedBy', (select coalesce(p.username, p.email) from public.app_settings s
                         join public.profiles p on p.id = s.updated_by
                         where s.key = igw_private.method_key(p_method, 'address')),
    'requiredConfirmations', igw_private.setting(igw_private.method_key(p_method, 'confirmations'))::int,
    'decimals', case p_method when 'usdt_trc20' then 6 else 8 end
  );
$$;

create or replace function igw_private.deposit_json(d public.deposit_requests)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', d.id,
    'reference', d.reference,
    'method', d.method,
    'asset', igw_private.method_asset(d.method),
    'network', d.network,
    'accountNumber', d.account_number,
    'userName', d.user_name,
    'amountUsd', d.amount_usd,
    'usdRate', d.usd_rate,
    'rateSource', d.rate_source,
    'amountUnits', d.amount_units,
    'amountCrypto', igw_private.format_units(d.method, d.amount_units),
    'depositAddress', d.deposit_address,
    'status', d.status,
    'txid', d.txid,
    'expiresAt', d.expires_at,
    'submitDeadline', d.expires_at + interval '30 minutes',
    'createdAt', d.created_at,
    'submittedAt', d.submitted_at,
    'creditedUsd', d.credited_usd,
    'reviewedAt', d.reviewed_at,
    'rejectionReason', d.rejection_reason,
    'verification', d.verification
  );
$$;

-- Cards and withdrawals (igw-rpc-9) -------------------------------------------
create or replace function igw_private.card_tier_name(p_tier text)
returns text
language sql
immutable
as $$
  select case p_tier when 'standard' then 'Standard' when 'gold' then 'Gold'
                     when 'premium' then 'Premium' when 'merchant' then 'Merchant' else p_tier end;
$$;

-- Daily (24 h) withdrawal limit in USD; null = unlimited.
create or replace function igw_private.card_limit(p_tier text)
returns numeric
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case when v is null or v = 'unlimited' then null else v::numeric end
  from (select igw_private.setting('card_limit_' || p_tier) as v) s;
$$;

create or replace function igw_private.card_tiers()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_agg(jsonb_build_object('tier', t.tier, 'name', igw_private.card_tier_name(t.tier),
                                      'dailyLimit', igw_private.card_limit(t.tier)) order by t.ord)
  from (values ('standard', 1), ('gold', 2), ('premium', 3), ('merchant', 4)) t(tier, ord);
$$;

-- Pending + sent withdrawals of the last 24 hours (rejected/cancelled ones do not count).
create or replace function igw_private.withdrawn_last_24h(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(sum(amount_usd), 0) from public.withdrawal_requests
  where user_id = p_user and status in ('pending', 'approved') and created_at > now() - interval '24 hours';
$$;

create or replace function igw_private.card_json(c public.member_cards)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case when c.user_id is null then null else jsonb_build_object(
    'cardNumber', c.card_number,
    'tier', c.tier,
    'tierName', igw_private.card_tier_name(c.tier),
    'status', c.status,
    'dailyLimit', igw_private.card_limit(c.tier),
    'activatedAt', c.activated_at,
    'validUntil', c.valid_until,
    'expired', c.valid_until is not null and c.valid_until <= now(),
    'holderName', (select full_name from public.profiles where id = c.user_id),
    'deactivatedAt', c.deactivated_at,
    'deactivationReason', c.deactivation_reason,
    'updatedAt', c.updated_at
  ) end;
$$;

create or replace function igw_private.card_request_json(r public.card_requests)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id, 'reference', r.reference, 'accountNumber', r.account_number, 'userName', r.user_name,
    'tier', r.tier, 'tierName', igw_private.card_tier_name(r.tier), 'dailyLimit', igw_private.card_limit(r.tier),
    'note', r.note, 'status', r.status, 'createdAt', r.created_at, 'reviewedAt', r.reviewed_at,
    'rejectionReason', r.rejection_reason
  ) end;
$$;

create or replace function igw_private.withdrawal_json(w public.withdrawal_requests)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', w.id, 'reference', w.reference, 'accountNumber', w.account_number, 'userName', w.user_name,
    'amountUsd', w.amount_usd, 'method', w.method, 'btcAddress', w.btc_address, 'cardTier', w.card_tier,
    'cardTierName', igw_private.card_tier_name(w.card_tier), 'status', w.status, 'txid', w.txid,
    'createdAt', w.created_at, 'reviewedAt', w.reviewed_at, 'rejectionReason', w.rejection_reason,
    'reviewedBy', (select coalesce(username, full_name) from public.profiles where id = w.reviewed_by)
  );
$$;

-- Everything the member's "Withdraw" section needs.
create or replace function igw_private.withdrawal_center(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_card public.member_cards%rowtype;
  v_limit numeric;
  v_used numeric := igw_private.withdrawn_last_24h(p_user);
begin
  select * into v_card from public.member_cards where user_id = p_user;
  v_limit := case when v_card.status = 'active' then igw_private.card_limit(v_card.tier) end;
  -- An expired card cannot be used until an admin renews it (re-activation).
  if v_card.status = 'active' and v_card.valid_until is not null and v_card.valid_until <= now() then
    v_card.status := 'expired';
    v_limit := null;
  end if;
  return jsonb_build_object(
    'card', igw_private.card_json(v_card),
    'pendingCardRequest', (select igw_private.card_request_json(r) from public.card_requests r
                           where r.user_id = p_user and r.status = 'pending' limit 1),
    'lastCardRequest', (select igw_private.card_request_json(r) from public.card_requests r
                        where r.user_id = p_user order by r.created_at desc, r.id desc limit 1),
    'tiers', igw_private.card_tiers(),
    'canWithdraw', coalesce(v_card.status = 'active', false),
    'dailyLimit', v_limit,
    'usedLast24h', v_used,
    'cardExpired', coalesce(v_card.status = 'expired', false),
    'remainingToday', case when v_card.status = 'active' then
                        case when v_limit is null then null else greatest(v_limit - v_used, 0) end
                      else 0 end,
    'minUsd', igw_private.setting('withdrawal_min_usd')::numeric,
    'withdrawals', coalesce((
      select jsonb_agg(igw_private.withdrawal_json(w) order by w.created_at desc, w.id desc)
      from (select * from public.withdrawal_requests where user_id = p_user order by created_at desc, id desc limit 50) w
    ), '[]'::jsonb)
  );
end;
$$;

-- Card number: 16 digits starting with 4, unique (only the last 4 are shown in the UI).
create or replace function igw_private.new_card_number()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  loop
    v := '4' || lpad((floor(random() * 1e15))::bigint::text, 15, '0');
    exit when not exists (select 1 from public.member_cards where card_number = v);
  end loop;
  return v;
end;
$$;

-- Activate / change tier of a member's card (admin action, used by request approval and direct setting).
create or replace function igw_private.activate_card(p_admin uuid, p_user uuid, p_tier text)
returns public.member_cards
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_card public.member_cards%rowtype;
begin
  insert into public.member_cards (user_id, card_number, tier, status, activated_at, activated_by, updated_at, valid_until)
  values (p_user, igw_private.new_card_number(), p_tier, 'active', now(), p_admin, now(), now() + interval '3 years')
  on conflict (user_id) do update
    set tier = excluded.tier, status = 'active', activated_at = now(), activated_by = p_admin,
        valid_until = now() + interval '3 years',
        deactivated_at = null, deactivated_by = null, deactivation_reason = null, updated_at = now()
  returning * into v_card;
  return v_card;
end;
$$;

-- Contact details shown on the website (igw-rpc-10).
create or replace function igw_private.contact_json()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'email', coalesce(igw_private.setting('contact_email'), ''),
    'phone', coalesce(igw_private.setting('contact_phone'), ''),
    'whatsapp', coalesce(igw_private.setting('contact_whatsapp'), ''),
    'telegram', coalesce(igw_private.setting('contact_telegram'), ''),
    'address', coalesce(igw_private.setting('contact_address'), ''),
    'hours', coalesce(igw_private.setting('contact_hours'), ''),
    'updatedAt', (select max(updated_at) from public.app_settings where key like 'contact\_%')
  );
$$;

create or replace function igw_private.transaction_json(t public.transactions)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', t.id,
    'reference', coalesce(t.reference, 'TX' || lpad(t.id::text, 10, '0')),
    'type', t.type,
    'direction', t.direction,
    'amount', t.amount,
    'currency', t.currency,
    'counterparty', t.counterparty,
    'counterpartyAccount', t.counterparty_account,
    'description', coalesce(nullif(t.description, ''), t.note, ''),
    'status', t.status,
    'createdAt', t.created_at
  );
$$;

-- igw-rpc-6: payment requests are NEVER closed automatically: no timeout, no
-- automatic approval or rejection. Only an admin (or the member, by cancelling
-- an unpaid request) changes the status. Kept as a no-op for older callers.
create or replace function igw_private.expire_deposits()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  null;
end;
$$;

-- New accounts start with a single USD balance of 0.00, tied to the account number.
create or replace function igw_private.provision_user(p_user_id uuid)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.wallets (user_id, currency, name, balance, account_number, is_primary, is_active)
  select p.id, 'USD', 'Main account', 0, p.account_number, true, true
  from public.profiles p
  where p.id = p_user_id;
$$;

-- Run in the Supabase SQL Editor (database owner only):
--   select igw_private.grant_admin('admin@example.com', 'enkyryyss');
-- The account must already exist (sign up on the website first). No password is stored here.
create or replace function igw_private.grant_admin(p_email text, p_username text default 'enkyryyss')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.profiles where email = lower(trim(p_email));
  if v_id is null then
    raise exception 'No account with email %. Sign up on the website first, then run this again.', p_email;
  end if;
  if p_username is not null then
    if exists (select 1 from public.profiles
               where lower(username) = lower(trim(p_username)) and id <> v_id) then
      raise exception 'Username % is already used by another account.', lower(trim(p_username));
    end if;
    update public.profiles set username = lower(trim(p_username)) where id = v_id;
  end if;
  insert into public.admin_roles (user_id, role, granted_by)
  values (v_id, 'admin', current_user)
  on conflict (user_id) do nothing;
  return 'Admin role granted to ' || lower(trim(p_email))
         || coalesce(' (username: ' || lower(trim(p_username)) || ')', '');
end;
$$;

create or replace function igw_private.revoke_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from public.admin_roles
  where user_id = (select id from public.profiles where email = lower(trim(p_email)));
  return 'Admin role removed from ' || lower(trim(p_email));
end;
$$;


revoke all on all functions in schema igw_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Data migration for existing accounts (balances are kept as they are)
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in select id from public.profiles where account_number is null loop
    update public.profiles set account_number = igw_private.new_account_number() where id = r.id;
  end loop;
end;
$$;
alter table public.profiles alter column account_number set not null;

drop trigger if exists profiles_lock_account_number on public.profiles;
create trigger profiles_lock_account_number
  before update of account_number on public.profiles
  for each row execute function igw_private.lock_account_number();

-- The USD wallet carries the 8-digit account number; other currencies are retired
-- (rows and balances are kept, but they are hidden and can no longer be used).
update public.wallets w
set account_number = p.account_number, is_primary = true, is_active = true
from public.profiles p
where w.user_id = p.id and w.currency = 'USD' and w.account_number is distinct from p.account_number;
update public.wallets set is_active = false, is_primary = false where currency <> 'USD' and is_active;
insert into public.wallets (user_id, currency, name, balance, account_number, is_primary, is_active)
select p.id, 'USD', 'Main account', 0, p.account_number, true, true
from public.profiles p
where not exists (select 1 from public.wallets w where w.user_id = p.id and w.currency = 'USD');

update public.transactions set reference = 'TX' || lpad(id::text, 10, '0') where reference is null;
update public.transactions set description = note where description = '' and note <> '';
alter table public.transactions alter column reference set not null;

-- If an account with the admin username already exists, make sure it has the role.
insert into public.admin_roles (user_id, granted_by)
select id, 'migration' from public.profiles where lower(username) = 'enkyryyss'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Public API (callable with the anon key; each function checks the session)
-- ---------------------------------------------------------------------------

-- Removed: the old demo "wallet action" (top up / withdraw / exchange) could
-- create balance out of nothing.
drop function if exists public.igw_wallet_action(text, text, numeric, bigint, bigint, bigint, bigint, text, text);
-- igw-rpc-5: BTC-only functions replaced by payment-method-aware ones.
drop function if exists public.igw_deposit_create(text, numeric, numeric, text);
drop function if exists public.igw_admin_set_btc_address(text, text);
drop function if exists public.igw_admin_set_deposits_enabled(text, boolean);
-- igw-rpc-7: approve gets p_accept_received.
drop function if exists public.igw_admin_approve(text, bigint, jsonb);
-- igw-rpc-8: no blockchain verification; the admin's decision completes the payment.
drop function if exists public.igw_admin_approve(text, bigint, jsonb, boolean);

create or replace function public.igw_health()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('ok', true, 'schema', 'igw-rpc-10');
$$;

create or replace function public.igw_sign_up(p_full_name text, p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := left(trim(coalesce(p_full_name, '')), 120);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_password text := coalesce(p_password, '');
  v_id uuid;
  v_constraint text;
begin
  if length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Please enter your full name.');
  end if;
  if length(v_email) > 180 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'error', 'Please enter a valid email address.');
  end if;
  if length(v_password) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Password must be at least 8 characters long.');
  end if;
  if octet_length(v_password) > 72 then
    return jsonb_build_object('ok', false, 'error', 'Password is too long (max 72 characters).');
  end if;
  if exists (select 1 from public.profiles where email = v_email) then
    return jsonb_build_object('ok', false, 'error', 'An account with this email already exists. Please sign in.');
  end if;
  -- The anon key is public, so throttle mass account creation.
  if (select count(*) from public.profiles where created_at > now() - interval '1 minute') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'Too many sign-ups right now. Please try again in a minute.');
  end if;

  -- Retry if two sign-ups draw the same random account number at the same moment.
  for attempt in 1..5 loop
    begin
      insert into public.profiles (full_name, email, password_hash, account_number)
        values (v_name, v_email, crypt(v_password, gen_salt('bf', 10)), igw_private.new_account_number())
        returning id into v_id;
      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'profiles_account_number_key' and attempt < 5 then
          continue;
        end if;
        return jsonb_build_object('ok', false, 'error', 'An account with this email already exists. Please sign in.');
    end;
  end loop;

  perform igw_private.provision_user(v_id);
  return jsonb_build_object('ok', true, 'token', igw_private.create_session(v_id));
end;
$$;

-- p_email accepts the email address or, for accounts that have one, the username.
create or replace function public.igw_sign_in(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_login text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
  v_hash text;
  v_valid boolean := false;
begin
  -- At most 5 failed attempts per login in 15 minutes (unknown logins too,
  -- so the lockout does not reveal which accounts exist).
  if (select count(*) from public.login_attempts
      where email = v_login and attempted_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error',
      'Too many failed sign-in attempts. Please wait 15 minutes and try again.');
  end if;

  select id, password_hash into v_id, v_hash
  from public.profiles
  where email = v_login
     or (position('@' in v_login) = 0 and lower(username) = v_login)
  limit 1;

  if v_hash is not null and v_hash like '$2%' then
    v_valid := crypt(coalesce(p_password, ''), v_hash) = v_hash;
  else
    -- Same work as a real check so timing does not reveal unknown accounts.
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));
  end if;

  if not v_valid then
    delete from public.login_attempts where attempted_at < now() - interval '1 day';
    insert into public.login_attempts (email) values (v_login);
    return jsonb_build_object('ok', false, 'error', 'Email or password is incorrect.');
  end if;

  delete from public.login_attempts where email = v_login;
  return jsonb_build_object('ok', true, 'token', igw_private.create_session(v_id));
end;
$$;

create or replace function public.igw_sign_out(p_token text)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  delete from public.sessions where token_hash = igw_private.token_hash(p_token);
  select jsonb_build_object('ok', true);
$$;

create or replace function public.igw_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.touch_session(p_token);
begin
  if v_uid is null then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'email', p.email, 'plan', p.plan,
      'username', p.username, 'accountNumber', p.account_number,
      'isAdmin', igw_private.is_admin(p.id)
    )
    from public.profiles p
    where p.id = v_uid
  );
end;
$$;

create or replace function public.igw_dashboard(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.touch_session(p_token);
  v_wallet public.wallets%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'You must be signed in');
  end if;
  perform igw_private.expire_deposits();
  select * into v_wallet from public.wallets where user_id = v_uid and currency = 'USD';

  return jsonb_build_object(
    'ok', true,
    'user', (
      select jsonb_build_object(
        'name', p.full_name, 'email', p.email, 'plan', p.plan, 'username', p.username,
        'accountNumber', p.account_number, 'isAdmin', igw_private.is_admin(p.id),
        'memberSince', p.created_at
      )
      from public.profiles p where p.id = v_uid
    ),
    'wallet', jsonb_build_object(
      'balance', coalesce(v_wallet.balance, 0),
      'currency', 'USD',
      'accountNumber', v_wallet.account_number
    ),
    'transactions', coalesce((
      select jsonb_agg(igw_private.transaction_json(t) order by t.created_at desc, t.id desc)
      from (
        select tx.*
        from public.transactions tx
        join public.wallets w on w.id = tx.wallet_id
        where w.user_id = v_uid
        order by tx.created_at desc, tx.id desc
        limit 50
      ) t
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'data', n.data,
        'read', n.read_at is not null, 'createdAt', n.created_at
      ) order by n.created_at desc, n.id desc)
      from (
        select * from public.notifications
        where user_id = v_uid
        order by created_at desc, id desc
        limit 30
      ) n
    ), '[]'::jsonb),
    'unreadCount', (select count(*) from public.notifications where user_id = v_uid and read_at is null),
    'deposits', coalesce((
      select jsonb_agg(igw_private.deposit_json(d) order by d.created_at desc, d.id desc)
      from (
        select * from public.deposit_requests
        where user_id = v_uid
        order by created_at desc, id desc
        limit 50
      ) d
    ), '[]'::jsonb),
    'openDeposit', (
      select igw_private.deposit_json(d)
      from public.deposit_requests d
      where d.user_id = v_uid and d.status in ('awaiting_payment', 'reviewing')
      order by d.created_at desc
      limit 1
    ),
    'depositConfig', jsonb_build_object(
      'methods', jsonb_build_array(igw_private.method_config('btc'), igw_private.method_config('usdt_trc20')),
      'minUsd', igw_private.setting('deposit_min_usd')::numeric,
      'maxUsd', igw_private.setting('deposit_max_usd')::numeric,
      'quoteMinutes', igw_private.setting('deposit_quote_minutes')::int
    ),
    'withdrawalCenter', igw_private.withdrawal_center(v_uid),
    'contact', igw_private.contact_json(),
    'flows', (
      select jsonb_build_object(
        'moneyIn', coalesce(sum(t.amount) filter (where t.direction = 'in'), 0),
        'moneyOut', coalesce(sum(t.amount) filter (where t.direction = 'out'), 0)
      )
      from public.transactions t
      where t.wallet_id = v_wallet.id
        and t.status = 'completed'
        and t.created_at >= now() - interval '30 days'
    )
  );
end;
$$;

create or replace function public.igw_notifications_read(p_token text, p_ids bigint[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
  v_count integer;
begin
  update public.notifications
  set read_at = now()
  where user_id = v_uid
    and read_at is null
    and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- BTC deposits
-- ---------------------------------------------------------------------------

-- SERVICE ROLE ONLY: the BTC/USD rate comes from the server, which fetched it
-- from the price APIs. The anon key must never be able to choose the rate.
-- SERVICE ROLE ONLY: the USD rate comes from the server (BTC: price APIs;
-- USDT: 1.00). The anon key must never be able to choose the rate.
create or replace function public.igw_deposit_create(
  p_token text, p_method text, p_amount_usd numeric, p_usd_rate numeric, p_rate_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
  v_method text := coalesce(p_method, '');
  v_address text;
  v_min numeric := igw_private.setting('deposit_min_usd')::numeric;
  v_max numeric := igw_private.setting('deposit_max_usd')::numeric;
  v_minutes integer := igw_private.setting('deposit_quote_minutes')::integer;
  v_amount numeric(14, 2);
  v_units bigint;
  v_base bigint;
  v_cents integer;
  v_request public.deposit_requests%rowtype;
begin
  if v_method not in ('btc', 'usdt_trc20') then
    raise exception 'Unknown payment method.';
  end if;
  perform igw_private.expire_deposits();
  v_address := igw_private.setting(igw_private.method_key(v_method, 'address'));

  if v_address is null then
    raise exception '% deposits are not available yet: no deposit address has been configured.',
      igw_private.method_asset(v_method);
  end if;
  if coalesce(igw_private.setting(igw_private.method_key(v_method, 'enabled')), 'true') <> 'true' then
    raise exception '% deposits are temporarily disabled. Please try again later.', igw_private.method_asset(v_method);
  end if;
  if p_amount_usd is null or p_amount_usd <> round(p_amount_usd, 2) then
    raise exception 'Enter an amount in USD with at most 2 decimal places.';
  end if;
  v_amount := p_amount_usd;
  if v_amount < v_min or v_amount > v_max then
    raise exception 'Deposit amount must be between % and % USD.', v_min, v_max;
  end if;
  if exists (select 1 from public.deposit_requests
             where user_id = v_uid and status in ('awaiting_payment', 'reviewing')) then
    raise exception 'You already have an open deposit request. Complete or cancel it first.';
  end if;

  if v_method = 'btc' then
    if p_usd_rate is null or p_usd_rate < 1000 or p_usd_rate > 10000000 then
      raise exception 'The BTC price could not be determined. Please try again.';
    end if;
    -- Exact satoshi amount, unique among open BTC requests.
    v_units := ceil(v_amount * 100000000 / p_usd_rate);
    while exists (select 1 from public.deposit_requests
                  where method = 'btc' and amount_units = v_units and status in ('awaiting_payment', 'reviewing')) loop
      v_units := v_units + 1;
    end loop;
  else
    if p_usd_rate is distinct from 1 then
      raise exception 'Invalid USDT rate.';
    end if;
    -- USDT is credited 1:1. A unique cent amount (0.01–0.99) is added so each
    -- payment matches exactly one open request; the member is credited the
    -- exact amount sent.
    v_base := (v_amount * 1000000)::bigint;
    v_units := null;
    for v_cents in 1..99 loop
      if not exists (select 1 from public.deposit_requests
                     where method = 'usdt_trc20' and amount_units = v_base + v_cents * 10000
                       and status in ('awaiting_payment', 'reviewing')) then
        v_units := v_base + v_cents * 10000;
        exit;
      end if;
    end loop;
    if v_units is null then
      raise exception 'Too many open requests for this amount. Please try a slightly different amount.';
    end if;
    v_amount := v_units / 1000000.0;
  end if;

  insert into public.deposit_requests (
    reference, user_id, account_number, user_name, method, network, amount_usd, usd_rate, rate_source,
    amount_units, deposit_address, expires_at
  )
  select igw_private.new_reference('DEP'), v_uid, p.account_number, p.full_name, v_method,
         case v_method when 'usdt_trc20' then 'tron' else 'mainnet' end,
         v_amount, round(p_usd_rate, 2), left(coalesce(p_rate_source, 'unknown'), 80),
         v_units, v_address, now() + make_interval(mins => v_minutes)
  from public.profiles p
  where p.id = v_uid
  returning * into v_request;

  return igw_private.deposit_json(v_request);
exception
  when unique_violation then
    raise exception 'You already have an open deposit request. Complete or cancel it first.';
end;
$$;

-- "I've paid": records the TXID and puts the request under review.
-- Does NOT change the balance. Admins are notified.
create or replace function public.igw_deposit_submit(p_token text, p_request_id bigint, p_txid text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
  v_txid text := lower(trim(coalesce(p_txid, '')));
  v_request public.deposit_requests%rowtype;
  v_profile public.profiles%rowtype;
  v_wallet_id bigint;
begin
  select * into v_request
  from public.deposit_requests
  where id = p_request_id and user_id = v_uid
  for update;
  if not found then
    raise exception 'Deposit request not found.';
  end if;
  if v_request.status = 'reviewing' then
    raise exception 'This payment has already been submitted and is under review.';
  end if;
  if v_request.status <> 'awaiting_payment' then
    raise exception 'This deposit request is %. Please create a new one.', replace(v_request.status, '_', ' ');
  end if;
  if v_txid !~ '^[0-9a-f]{64}$' then
    raise exception 'Enter a valid transaction ID (TXID / hash: 64 hexadecimal characters).';
  end if;
  if exists (select 1 from public.deposit_requests where txid = v_txid) then
    raise exception 'This transaction ID has already been submitted.';
  end if;

  update public.deposit_requests
  set status = 'reviewing', txid = v_txid, submitted_at = now()
  where id = v_request.id
  returning * into v_request;

  select * into v_profile from public.profiles where id = v_uid;
  select id into v_wallet_id from public.wallets where user_id = v_uid and currency = 'USD';

  -- Shown as "pending" in the user's history until an admin approves or rejects it.
  insert into public.transactions (
    wallet_id, type, direction, amount, currency, counterparty, note, status,
    reference, description, deposit_request_id
  ) values (
    v_wallet_id, 'deposit', 'in', v_request.amount_usd, 'USD',
    case v_request.method when 'usdt_trc20' then 'Tether (USDT TRC20)' else 'Bitcoin (BTC)' end, '', 'pending',
    v_request.reference,
    igw_private.method_asset(v_request.method) || ' deposit · '
      || igw_private.format_units(v_request.method, v_request.amount_units) || ' ' || igw_private.method_asset(v_request.method),
    v_request.id
  );

  perform igw_private.notify_admins(
    'deposit_submitted',
    format('New %s payment request', case v_request.method when 'usdt_trc20' then 'USDT TRC20' else 'BTC' end),
    format('%s (account %s) reports a payment of %s USD / %s %s.',
           v_profile.full_name, v_profile.account_number, v_request.amount_usd,
           igw_private.format_units(v_request.method, v_request.amount_units), igw_private.method_asset(v_request.method)),
    jsonb_build_object(
      'requestId', v_request.id,
      'reference', v_request.reference,
      'userName', v_profile.full_name,
      'accountNumber', v_profile.account_number,
      'email', v_profile.email,
      'amountUsd', v_request.amount_usd,
      'method', v_request.method,
      'asset', igw_private.method_asset(v_request.method),
      'amountCrypto', igw_private.format_units(v_request.method, v_request.amount_units),
      'depositAddress', v_request.deposit_address,
      'txid', v_request.txid,
      'createdAt', v_request.created_at,
      'submittedAt', v_request.submitted_at,
      'status', v_request.status
    )
  );
  perform igw_private.notify(
    v_uid, 'deposit_submitted', 'Payment request received',
    format('Your payment request has been received. Awaiting admin review. (ref. %s, %s USD, %s %s)',
           v_request.reference, v_request.amount_usd,
           igw_private.format_units(v_request.method, v_request.amount_units), igw_private.method_asset(v_request.method)),
    jsonb_build_object('requestId', v_request.id, 'reference', v_request.reference)
  );

  return igw_private.deposit_json(v_request);
exception
  when unique_violation then
    raise exception 'This transaction ID has already been submitted.';
end;
$$;

create or replace function public.igw_deposit_cancel(p_token text, p_request_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
  v_request public.deposit_requests%rowtype;
begin
  update public.deposit_requests
  set status = 'cancelled'
  where id = p_request_id and user_id = v_uid and status = 'awaiting_payment'
  returning * into v_request;
  if not found then
    raise exception 'Only a deposit request that is still waiting for payment can be cancelled.';
  end if;
  return igw_private.deposit_json(v_request);
end;
$$;

-- ---------------------------------------------------------------------------
-- Transfers between members (by 8-digit account number)
-- ---------------------------------------------------------------------------

create or replace function public.igw_transfer_lookup(p_token text, p_account_number text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
  v_account text := trim(coalesce(p_account_number, ''));
  v_recipient public.profiles%rowtype;
begin
  if v_account !~ '^[0-9]{8}$' then
    raise exception 'Account numbers have exactly 8 digits.';
  end if;
  -- Limit lookups so account numbers cannot be scanned.
  if (select count(*) from public.transfer_lookups
      where user_id = v_uid and looked_up_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Too many account lookups. Please wait a few minutes.';
  end if;
  delete from public.transfer_lookups where looked_up_at < now() - interval '1 day';
  insert into public.transfer_lookups (user_id) values (v_uid);

  select * into v_recipient from public.profiles where account_number = v_account;
  if not found then
    raise exception 'No account found with this number.';
  end if;
  if v_recipient.id = v_uid then
    raise exception 'You cannot transfer money to your own account.';
  end if;
  return jsonb_build_object('accountNumber', v_account, 'name', igw_private.mask_name(v_recipient.full_name));
end;
$$;

-- Atomic transfer. p_idempotency_key makes retries safe: the same key never
-- moves money twice.
create or replace function public.igw_transfer_send(
  p_token text, p_account_number text, p_amount numeric, p_idempotency_key uuid, p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
  v_account text := trim(coalesce(p_account_number, ''));
  v_note text := left(trim(coalesce(p_note, '')), 140);
  v_sender public.profiles%rowtype;
  v_recipient public.profiles%rowtype;
  v_existing public.transfers%rowtype;
  v_transfer public.transfers%rowtype;
  v_sender_wallet public.wallets%rowtype;
  v_recipient_wallet public.wallets%rowtype;
begin
  if p_idempotency_key is null then
    raise exception 'Missing request id. Please try again.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'Use at most 2 decimal places.';
  end if;
  if p_amount > 1000000000 then
    raise exception 'Amount is too large.';
  end if;
  if v_account !~ '^[0-9]{8}$' then
    raise exception 'Account numbers have exactly 8 digits.';
  end if;

  select * into v_sender from public.profiles where id = v_uid;
  select * into v_recipient from public.profiles where account_number = v_account;
  if not found then
    raise exception 'No account found with this number.';
  end if;
  if v_recipient.id = v_uid then
    raise exception 'You cannot transfer money to your own account.';
  end if;

  -- Lock both balances in a fixed order (by wallet id) so concurrent transfers
  -- between the same two people cannot deadlock or overspend.
  perform 1 from public.wallets
  where user_id in (v_uid, v_recipient.id) and currency = 'USD'
  order by id
  for update;

  select * into v_existing from public.transfers
  where sender_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.recipient_id <> v_recipient.id or v_existing.amount <> p_amount then
      raise exception 'This request id was already used for a different transfer.';
    end if;
    select * into v_sender_wallet from public.wallets where user_id = v_uid and currency = 'USD';
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'reference', v_existing.reference, 'amount', v_existing.amount,
      'recipientName', igw_private.mask_name(v_recipient.full_name), 'recipientAccount', v_account,
      'balance', v_sender_wallet.balance, 'createdAt', v_existing.created_at
    );
  end if;

  select * into v_sender_wallet from public.wallets where user_id = v_uid and currency = 'USD';
  select * into v_recipient_wallet from public.wallets where user_id = v_recipient.id and currency = 'USD';
  if v_sender_wallet.id is null or v_recipient_wallet.id is null then
    raise exception 'Wallet not found.';
  end if;
  if v_sender_wallet.balance < p_amount then
    raise exception 'Insufficient balance.';
  end if;

  insert into public.transfers (reference, sender_id, recipient_id, amount, note, idempotency_key)
  values (igw_private.new_reference('TRF'), v_uid, v_recipient.id, p_amount, v_note, p_idempotency_key)
  returning * into v_transfer;

  update public.wallets set balance = balance - p_amount where id = v_sender_wallet.id
  returning * into v_sender_wallet;
  update public.wallets set balance = balance + p_amount where id = v_recipient_wallet.id;

  insert into public.transactions (
    wallet_id, type, direction, amount, currency, counterparty, counterparty_account,
    note, status, reference, description, transfer_id
  ) values
    (v_sender_wallet.id, 'transfer_out', 'out', p_amount, 'USD',
     igw_private.mask_name(v_recipient.full_name), v_recipient.account_number,
     v_note, 'completed', v_transfer.reference,
     coalesce(nullif(v_note, ''), 'Transfer to ' || v_recipient.account_number), v_transfer.id),
    (v_recipient_wallet.id, 'transfer_in', 'in', p_amount, 'USD',
     igw_private.mask_name(v_sender.full_name), v_sender.account_number,
     v_note, 'completed', v_transfer.reference,
     coalesce(nullif(v_note, ''), 'Transfer from ' || v_sender.account_number), v_transfer.id);

  perform igw_private.notify(
    v_uid, 'transfer_sent', 'Transfer sent',
    format('You sent %s USD to account %s (ref. %s).', p_amount, v_recipient.account_number, v_transfer.reference),
    jsonb_build_object('reference', v_transfer.reference, 'amount', p_amount)
  );
  perform igw_private.notify(
    v_recipient.id, 'transfer_received', 'Money received',
    format('You received %s USD from account %s (ref. %s).', p_amount, v_sender.account_number, v_transfer.reference),
    jsonb_build_object('reference', v_transfer.reference, 'amount', p_amount)
  );

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'reference', v_transfer.reference, 'amount', p_amount,
    'recipientName', igw_private.mask_name(v_recipient.full_name), 'recipientAccount', v_account,
    'balance', v_sender_wallet.balance, 'createdAt', v_transfer.created_at
  );
exception
  when unique_violation then
    -- Two simultaneous calls with the same idempotency key: the other one won.
    raise exception 'This transfer is already being processed.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin (every function checks admin_roles through the session token)
-- ---------------------------------------------------------------------------

create or replace function igw_private.admin_deposit_row(d public.deposit_requests)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select igw_private.deposit_json(d) || jsonb_build_object(
    'user', (
      select jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'email', p.email, 'accountNumber', p.account_number,
        'balance', (select balance from public.wallets w where w.user_id = p.id and w.currency = 'USD'),
        'memberSince', p.created_at
      )
      from public.profiles p where p.id = d.user_id
    ),
    'reviewedBy', (select full_name from public.profiles where id = d.reviewed_by)
  );
$$;

create or replace function public.igw_admin_overview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
begin
  perform igw_private.expire_deposits();
  return jsonb_build_object(
    'admin', (select jsonb_build_object('name', full_name, 'email', email, 'username', username)
              from public.profiles where id = v_admin),
    'counts', jsonb_build_object(
      'new', (select count(*) from public.notifications
              where user_id = v_admin and kind = 'deposit_submitted' and read_at is null),
      'byMethod', (select jsonb_object_agg(m.method, jsonb_build_object(
                     'reviewing', (select count(*) from public.deposit_requests d where d.method = m.method and d.status = 'reviewing'),
                     'approved', (select count(*) from public.deposit_requests d where d.method = m.method and d.status = 'approved'),
                     'rejected', (select count(*) from public.deposit_requests d where d.method = m.method and d.status = 'rejected')))
                   from (values ('btc'), ('usdt_trc20')) m(method)),
      'reviewing', (select count(*) from public.deposit_requests where status = 'reviewing'),
      'awaitingPayment', (select count(*) from public.deposit_requests where status = 'awaiting_payment'),
      'approved', (select count(*) from public.deposit_requests where status = 'approved'),
      'rejected', (select count(*) from public.deposit_requests where status = 'rejected'),
      'withdrawalsPending', (select count(*) from public.withdrawal_requests where status = 'pending'),
      'cardRequestsPending', (select count(*) from public.card_requests where status = 'pending'),
      'activeCards', (select count(*) from public.member_cards where status = 'active'),
      'users', (select count(*) from public.profiles),
      'totalBalance', (select coalesce(sum(balance), 0) from public.wallets where currency = 'USD')
    ),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'data', n.data,
        'read', n.read_at is not null, 'createdAt', n.created_at
      ) order by n.created_at desc, n.id desc)
      from (select * from public.notifications where user_id = v_admin
            order by created_at desc, id desc limit 50) n
    ), '[]'::jsonb),
    'unreadCount', (select count(*) from public.notifications where user_id = v_admin and read_at is null),
    'auditLog', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'admin', a.admin_label, 'action', a.action, 'targetType', a.target_type,
        'targetId', a.target_id, 'details', a.details, 'createdAt', a.created_at
      ) order by a.created_at desc, a.id desc)
      from (select * from public.admin_audit_log order by created_at desc, id desc limit 100) a
    ), '[]'::jsonb),
    'contact', igw_private.contact_json(),
    'settings', jsonb_build_object(
      'methods', jsonb_build_array(igw_private.method_config('btc'), igw_private.method_config('usdt_trc20')),
      'minUsd', igw_private.setting('deposit_min_usd')::numeric,
      'maxUsd', igw_private.setting('deposit_max_usd')::numeric,
      'quoteMinutes', igw_private.setting('deposit_quote_minutes')::int
    )
  );
end;
$$;

create or replace function public.igw_admin_deposits(p_token text, p_status text default null, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
begin
  perform igw_private.expire_deposits();
  return coalesce((
    select jsonb_agg(igw_private.admin_deposit_row(d)
                     order by (d.status = 'reviewing') desc, d.created_at desc, d.id desc)
    from (
      select * from public.deposit_requests
      where p_status is null or status = p_status
      order by (status = 'reviewing') desc, created_at desc, id desc
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) d
  ), '[]'::jsonb);
end;
$$;

create or replace function public.igw_admin_deposit(p_token text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_request public.deposit_requests%rowtype;
begin
  select * into v_request from public.deposit_requests where id = p_id;
  if not found then
    raise exception 'Deposit request not found.';
  end if;
  return igw_private.admin_deposit_row(v_request) || jsonb_build_object(
    'requiredConfirmations', igw_private.setting(igw_private.method_key(v_request.method, 'confirmations'))::int,
    'userTransactions', coalesce((
      select jsonb_agg(igw_private.transaction_json(t) order by t.created_at desc, t.id desc)
      from (select tx.* from public.transactions tx
            join public.wallets w on w.id = tx.wallet_id
            where w.user_id = v_request.user_id
            order by tx.created_at desc, tx.id desc limit 20) t
    ), '[]'::jsonb)
  );
end;
$$;

-- Admin decision only (igw-rpc-8): there is NO blockchain verification. Approving
-- completes the payment: the member's balance is credited once, atomically (row lock +
-- status check), the transaction is completed, the member is notified and the action
-- is written to the audit log. Only an admin session can call it.
-- p_credit_usd: optional LOWER amount actually received (e.g. exchange fee deducted);
-- default = the requested amount.
create or replace function public.igw_admin_approve(p_token text, p_id bigint, p_credit_usd numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_request public.deposit_requests%rowtype;
  v_wallet public.wallets%rowtype;
  v_credit numeric(14, 2);
begin
  select * into v_request from public.deposit_requests where id = p_id for update;
  if not found then
    raise exception 'Deposit request not found.';
  end if;
  if v_request.status = 'approved' then
    raise exception 'This deposit has already been approved.';
  end if;
  if v_request.status <> 'reviewing' then
    raise exception 'Only payments marked as paid ("I''ve paid") can be approved (status: %).', replace(v_request.status, '_', ' ');
  end if;
  if p_credit_usd is not null and p_credit_usd <> round(p_credit_usd, 2) then
    raise exception 'Enter the amount to credit with at most 2 decimal places.';
  end if;
  v_credit := coalesce(p_credit_usd, v_request.amount_usd);
  if v_credit <= 0 or v_credit > v_request.amount_usd then
    raise exception 'The amount to credit must be more than 0 and at most the requested % USD.', v_request.amount_usd;
  end if;

  update public.wallets
  set balance = balance + v_credit
  where user_id = v_request.user_id and currency = 'USD'
  returning * into v_wallet;
  if not found then
    raise exception 'The member has no USD wallet.';
  end if;

  update public.transactions
  set status = 'completed', amount = v_credit,
      description = description || ' · TXID ' || left(v_request.txid, 12) || '…'
  where deposit_request_id = v_request.id and status = 'pending';
  if not found then
    insert into public.transactions (
      wallet_id, type, direction, amount, currency, counterparty, note, status,
      reference, description, deposit_request_id
    ) values (
      v_wallet.id, 'deposit', 'in', v_credit, 'USD',
      case v_request.method when 'usdt_trc20' then 'Tether (USDT TRC20)' else 'Bitcoin (BTC)' end, '', 'completed',
      v_request.reference,
      igw_private.method_asset(v_request.method) || ' deposit · '
        || igw_private.format_units(v_request.method, v_request.amount_units) || ' ' || igw_private.method_asset(v_request.method),
      v_request.id
    );
  end if;

  update public.deposit_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = v_admin, credited_usd = v_credit,
      verification = jsonb_build_object('mode', 'manual', 'approvedAt', now())
  where id = v_request.id
  returning * into v_request;

  update public.notifications
  set read_at = now()
  where kind = 'deposit_submitted' and read_at is null and (data->>'requestId')::bigint = v_request.id;

  perform igw_private.audit(v_admin, 'deposit_approved', 'deposit_request', v_request.reference,
    jsonb_build_object('requestId', v_request.id, 'method', v_request.method, 'accountNumber', v_request.account_number,
                       'amountUsd', v_request.amount_usd, 'creditedUsd', v_credit,
                       'amountUnits', v_request.amount_units, 'txid', v_request.txid, 'mode', 'manual'));
  perform igw_private.notify(
    v_request.user_id, 'deposit_approved', 'Payment approved',
    format('Your payment has been approved and added to your balance: %s USD (ref. %s).', v_credit, v_request.reference),
    jsonb_build_object('requestId', v_request.id, 'reference', v_request.reference, 'amountUsd', v_credit)
  );

  return jsonb_build_object('ok', true, 'deposit', igw_private.admin_deposit_row(v_request), 'newBalance', v_wallet.balance,
                            'creditedUsd', v_credit);
end;
$$;

create or replace function public.igw_admin_reject(p_token text, p_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_request public.deposit_requests%rowtype;
begin
  if length(v_reason) < 3 then
    raise exception 'Please enter a reason for the rejection.';
  end if;
  select * into v_request from public.deposit_requests where id = p_id for update;
  if not found then
    raise exception 'Deposit request not found.';
  end if;
  if v_request.status not in ('reviewing', 'awaiting_payment') then
    raise exception 'This deposit can no longer be rejected (status: %).', replace(v_request.status, '_', ' ');
  end if;

  update public.deposit_requests
  set status = 'rejected', rejection_reason = v_reason, reviewed_at = now(), reviewed_by = v_admin
  where id = v_request.id
  returning * into v_request;

  update public.transactions
  set status = 'failed', description = description || ' · Rejected: ' || v_reason
  where deposit_request_id = v_request.id and status = 'pending';

  update public.notifications
  set read_at = now()
  where kind = 'deposit_submitted' and read_at is null and (data->>'requestId')::bigint = v_request.id;

  perform igw_private.audit(v_admin, 'deposit_rejected', 'deposit_request', v_request.reference,
    jsonb_build_object('requestId', v_request.id, 'method', v_request.method, 'accountNumber', v_request.account_number,
                       'amountUsd', v_request.amount_usd, 'txid', v_request.txid, 'reason', v_reason));
  perform igw_private.notify(
    v_request.user_id, 'deposit_rejected', 'Payment rejected',
    format('Your payment request was rejected. Reason: %s (ref. %s, %s USD)', v_reason, v_request.reference, v_request.amount_usd),
    jsonb_build_object('requestId', v_request.id, 'reference', v_request.reference, 'reason', v_reason)
  );

  return jsonb_build_object('ok', true, 'deposit', igw_private.admin_deposit_row(v_request));
end;
$$;

create or replace function public.igw_admin_transactions(p_token text, p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
begin
  return coalesce((
    select jsonb_agg(igw_private.transaction_json(t) || jsonb_build_object(
      'user', jsonb_build_object('name', p.full_name, 'email', p.email, 'accountNumber', p.account_number)
    ) order by t.created_at desc, t.id desc)
    from (select * from public.transactions order by created_at desc, id desc
          limit least(greatest(coalesce(p_limit, 200), 1), 1000)) t
    join public.wallets w on w.id = t.wallet_id
    join public.profiles p on p.id = w.user_id
  ), '[]'::jsonb);
end;
$$;

-- SERVICE ROLE ONLY: the server validates the address checksum (mainnet only)
-- before calling. Open requests keep the address they were shown.
-- Admin session required (checked here). The server also verifies the address
-- checksum (BTC mainnet / TRON mainnet) before calling. Since igw-rpc-6 this does
-- not need the service role key, so addresses can be saved even before that key
-- is configured. Requests already created keep their address.
create or replace function public.igw_admin_set_deposit_address(p_token text, p_method text, p_address text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_method text := coalesce(p_method, '');
  v_key text := igw_private.method_key(p_method, 'address');
  v_address text := trim(coalesce(p_address, ''));
  v_previous text;
begin
  if v_key is null then
    raise exception 'Unknown payment method.';
  end if;
  if v_address = '' then
    raise exception 'Enter an address.';
  end if;
  if not igw_private.deposit_address_valid(v_method, v_address) then
    raise exception 'Enter a valid % address (checksum verified).', case v_method when 'usdt_trc20' then 'TRON (TRC20)' else 'Bitcoin mainnet' end;
  end if;
  if v_method = 'usdt_trc20' and v_address = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' then
    raise exception 'This is the USDT token contract, not a wallet address.';
  end if;
  v_previous := igw_private.setting(v_key);
  insert into public.app_settings (key, value, updated_at, updated_by)
  values (v_key, v_address, now(), v_admin)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = v_admin;

  perform igw_private.audit(v_admin, 'deposit_address_changed', 'setting', v_key,
    jsonb_build_object('method', v_method, 'previous', v_previous, 'new', v_address));
  perform igw_private.notify_admins(
    'settings_changed', format('%s deposit address changed', igw_private.method_asset(v_method)),
    format('The %s deposit address was set to %s by %s.', igw_private.method_asset(v_method), v_address,
           (select coalesce(username, email) from public.profiles where id = v_admin)),
    jsonb_build_object('method', v_method, 'address', v_address)
  );
  return jsonb_build_object('ok', true, 'method', v_method, 'address', v_address);
end;
$$;

-- Lightweight check for the admin panel (every few seconds): counters and the
-- payment requests the admin has not seen yet. Used for the sound alert.
create or replace function public.igw_admin_poll(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
begin
  return jsonb_build_object(
    'reviewing', (select count(*) from public.deposit_requests where status = 'reviewing'),
    'approved', (select count(*) from public.deposit_requests where status = 'approved'),
    'rejected', (select count(*) from public.deposit_requests where status = 'rejected'),
    'unreadCount', (select count(*) from public.notifications where user_id = v_admin and read_at is null),
    'latestRequestNotificationId', (select max(id) from public.notifications
                                    where user_id = v_admin and kind in ('deposit_submitted', 'withdrawal_submitted', 'card_requested')),
    'withdrawalsPending', (select count(*) from public.withdrawal_requests where status = 'pending'),
    'cardRequestsPending', (select count(*) from public.card_requests where status = 'pending'),
    'newOther', coalesce((
      select jsonb_agg(jsonb_build_object(
        'notificationId', n.id, 'kind', n.kind,
        'id', coalesce((n.data->>'withdrawalId')::bigint, (n.data->>'cardRequestId')::bigint),
        'reference', n.data->>'reference', 'amountUsd', n.data->'amountUsd', 'tier', n.data->>'tier',
        'userName', n.data->>'userName'
      ) order by n.id)
      from public.notifications n
      where n.user_id = v_admin and n.kind in ('withdrawal_submitted', 'card_requested') and n.read_at is null
    ), '[]'::jsonb),
    'newRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'notificationId', n.id, 'requestId', (n.data->>'requestId')::bigint, 'reference', n.data->>'reference',
        'method', n.data->>'method', 'amountUsd', n.data->'amountUsd', 'userName', n.data->>'userName'
      ) order by n.id)
      from public.notifications n
      where n.user_id = v_admin and n.kind = 'deposit_submitted' and n.read_at is null
    ), '[]'::jsonb)
  );
end;
$$;

-- Lets the server check that SUPABASE_SERVICE_ROLE_KEY is present AND correct.
create or replace function public.igw_service_ping()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('ok', true);
$$;

create or replace function public.igw_admin_set_method_enabled(p_token text, p_method text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_key text := igw_private.method_key(p_method, 'enabled');
  v_value text := case when coalesce(p_enabled, false) then 'true' else 'false' end;
begin
  if v_key is null then
    raise exception 'Unknown payment method.';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values (v_key, v_value, now(), v_admin)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = v_admin;
  perform igw_private.audit(v_admin, case when v_value = 'true' then 'deposits_enabled' else 'deposits_disabled' end,
    'setting', v_key, jsonb_build_object('method', p_method, 'enabled', v_value = 'true'));
  return jsonb_build_object('ok', true, 'method', p_method, 'enabled', v_value = 'true');
end;
$$;

-- ---------------------------------------------------------------------------
-- Cards and withdrawals: member functions (igw-rpc-9)
-- ---------------------------------------------------------------------------

create or replace function public.igw_withdrawal_center(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
begin
  return igw_private.withdrawal_center(v_uid);
end;
$$;

-- Member asks for a card (or a different tier). An admin decides; there is no fee.
create or replace function public.igw_card_request(p_token text, p_tier text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
  v_profile public.profiles%rowtype;
  v_card public.member_cards%rowtype;
  v_request public.card_requests%rowtype;
begin
  if p_tier is null or p_tier not in ('standard', 'gold', 'premium', 'merchant') then
    raise exception 'Choose a card: Standard, Gold, Premium or Merchant.';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  select * into v_card from public.member_cards where user_id = v_uid;
  -- An expired card of the same tier may be requested again (renewal).
  if v_card.status = 'active' and v_card.tier = p_tier and (v_card.valid_until is null or v_card.valid_until > now()) then
    raise exception 'Your % card is already active.', igw_private.card_tier_name(p_tier);
  end if;
  if exists (select 1 from public.card_requests where user_id = v_uid and status = 'pending') then
    raise exception 'You already have a card request waiting for review.';
  end if;
  insert into public.card_requests (reference, user_id, account_number, user_name, tier, note)
  values (igw_private.new_reference('CRD'), v_uid, v_profile.account_number, v_profile.full_name, p_tier,
          left(trim(coalesce(p_note, '')), 300))
  returning * into v_request;

  perform igw_private.notify(v_uid, 'card_request_received', 'Card request received',
    format('Your %s card request (ref. %s) has been received. Awaiting admin review.', igw_private.card_tier_name(p_tier), v_request.reference),
    jsonb_build_object('requestId', v_request.id, 'reference', v_request.reference, 'tier', p_tier));
  perform igw_private.notify_admins('card_requested', 'New card request',
    format('%s (account %s) requests a %s card.', v_profile.full_name, v_profile.account_number, igw_private.card_tier_name(p_tier)),
    jsonb_build_object('cardRequestId', v_request.id, 'reference', v_request.reference, 'tier', p_tier,
                       'userName', v_profile.full_name, 'accountNumber', v_profile.account_number));
  return igw_private.card_request_json(v_request);
exception
  when unique_violation then
    raise exception 'You already have a card request waiting for review.';
end;
$$;

create or replace function public.igw_card_request_cancel(p_token text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
  v_request public.card_requests%rowtype;
begin
  update public.card_requests set status = 'cancelled', reviewed_at = now()
  where id = p_id and user_id = v_uid and status = 'pending'
  returning * into v_request;
  if not found then
    raise exception 'Only your own pending card request can be cancelled.';
  end if;
  return igw_private.card_request_json(v_request);
end;
$$;

-- Withdrawal request: needs an ACTIVE card, a valid BTC mainnet address, enough balance
-- and room in the card's 24 h limit. The amount is taken from the balance at once
-- (reserved) and given back if the admin rejects or the member cancels.
create or replace function public.igw_withdrawal_create(p_token text, p_amount_usd numeric, p_btc_address text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
  v_profile public.profiles%rowtype;
  v_card public.member_cards%rowtype;
  v_wallet public.wallets%rowtype;
  v_address text := trim(coalesce(p_btc_address, ''));
  v_min numeric := igw_private.setting('withdrawal_min_usd')::numeric;
  v_limit numeric;
  v_used numeric;
  v_request public.withdrawal_requests%rowtype;
  v_tx public.transactions%rowtype;
begin
  select * into v_card from public.member_cards where user_id = v_uid;
  if not found or v_card.status <> 'active' then
    raise exception 'You need an active card to withdraw. Request a card in the Withdraw section; an admin activates it.';
  end if;
  if v_card.valid_until is not null and v_card.valid_until <= now() then
    raise exception 'Your card expired on %. Ask an admin to renew it.', to_char(v_card.valid_until at time zone 'Europe/Istanbul', 'MM/YY');
  end if;
  if p_amount_usd is null or p_amount_usd <> round(p_amount_usd, 2) or p_amount_usd <= 0 then
    raise exception 'Enter an amount in USD with at most 2 decimal places.';
  end if;
  if p_amount_usd < v_min then
    raise exception 'The minimum withdrawal is % USD.', v_min;
  end if;
  if not igw_private.deposit_address_valid('btc', v_address) then
    raise exception 'Enter a valid Bitcoin (mainnet) address.';
  end if;

  -- Lock the wallet: balance and daily limit are checked and changed atomically.
  select * into v_wallet from public.wallets where user_id = v_uid and currency = 'USD' for update;
  if not found then
    raise exception 'No USD wallet found.';
  end if;
  if v_wallet.balance < p_amount_usd then
    raise exception 'Insufficient balance. Available: % USD.', v_wallet.balance;
  end if;
  v_limit := igw_private.card_limit(v_card.tier);
  v_used := igw_private.withdrawn_last_24h(v_uid);
  if v_limit is not null and v_used + p_amount_usd > v_limit then
    raise exception 'Daily limit of your % card is % USD. Used in the last 24 hours: % USD, still available: % USD.',
      igw_private.card_tier_name(v_card.tier), v_limit, v_used, greatest(v_limit - v_used, 0);
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  insert into public.withdrawal_requests (reference, user_id, account_number, user_name, amount_usd, btc_address, card_tier)
  values (igw_private.new_reference('WDR'), v_uid, v_profile.account_number, v_profile.full_name, p_amount_usd, v_address, v_card.tier)
  returning * into v_request;

  update public.wallets set balance = balance - p_amount_usd where id = v_wallet.id;
  insert into public.transactions (
    wallet_id, type, direction, amount, currency, counterparty, counterparty_account, note, status,
    reference, description, withdrawal_request_id
  ) values (
    v_wallet.id, 'withdrawal', 'out', p_amount_usd, 'USD', 'Bitcoin (BTC)', v_address, '', 'pending',
    v_request.reference, 'BTC withdrawal to ' || left(v_address, 10) || '…', v_request.id
  ) returning * into v_tx;

  perform igw_private.notify(v_uid, 'withdrawal_received', 'Withdrawal request received',
    format('Your withdrawal request of %s USD (ref. %s) has been received. Awaiting admin review.', p_amount_usd, v_request.reference),
    jsonb_build_object('withdrawalId', v_request.id, 'reference', v_request.reference, 'amountUsd', p_amount_usd));
  perform igw_private.notify_admins('withdrawal_submitted', 'New withdrawal request',
    format('%s (account %s) requests %s USD to %s (%s card).', v_profile.full_name, v_profile.account_number,
           p_amount_usd, v_address, igw_private.card_tier_name(v_card.tier)),
    jsonb_build_object('withdrawalId', v_request.id, 'reference', v_request.reference, 'amountUsd', p_amount_usd,
                       'userName', v_profile.full_name, 'accountNumber', v_profile.account_number,
                       'btcAddress', v_address, 'cardTier', v_card.tier));
  return igw_private.withdrawal_json(v_request);
end;
$$;

create or replace function public.igw_withdrawal_cancel(p_token text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.require_user(p_token);
  v_request public.withdrawal_requests%rowtype;
begin
  select * into v_request from public.withdrawal_requests where id = p_id and user_id = v_uid for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Only your own pending withdrawal can be cancelled.';
  end if;
  update public.wallets set balance = balance + v_request.amount_usd where user_id = v_uid and currency = 'USD';
  update public.transactions set status = 'cancelled' where withdrawal_request_id = v_request.id and status = 'pending';
  update public.withdrawal_requests set status = 'cancelled', reviewed_at = now() where id = v_request.id
  returning * into v_request;
  update public.notifications set read_at = now()
  where kind = 'withdrawal_submitted' and read_at is null and (data->>'withdrawalId')::bigint = v_request.id;
  return igw_private.withdrawal_json(v_request);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cards and withdrawals: admin functions (igw-rpc-9)
-- ---------------------------------------------------------------------------

create or replace function igw_private.admin_withdrawal_row(w public.withdrawal_requests)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select igw_private.withdrawal_json(w) || jsonb_build_object(
    'user', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'accountNumber', p.account_number,
                                       'balance', (select balance from public.wallets x where x.user_id = p.id and x.currency = 'USD'))
             from public.profiles p where p.id = w.user_id)
  );
$$;

create or replace function public.igw_admin_withdrawals(p_token text, p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
begin
  return coalesce((
    select jsonb_agg(igw_private.admin_withdrawal_row(w) order by (w.status = 'pending') desc, w.created_at desc, w.id desc)
    from (select * from public.withdrawal_requests
          where p_status is null or status = p_status
          order by (status = 'pending') desc, created_at desc, id desc limit 300) w
  ), '[]'::jsonb);
end;
$$;

-- Admin marks the withdrawal as SENT (after sending the BTC from the company wallet).
create or replace function public.igw_admin_withdrawal_approve(p_token text, p_id bigint, p_txid text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_request public.withdrawal_requests%rowtype;
  v_txid text := nullif(lower(trim(coalesce(p_txid, ''))), '');
begin
  select * into v_request from public.withdrawal_requests where id = p_id for update;
  if not found then
    raise exception 'Withdrawal request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This withdrawal has already been %.', case v_request.status when 'approved' then 'approved' else replace(v_request.status, '_', ' ') end;
  end if;
  if v_txid is not null and v_txid !~ '^[0-9a-f]{64}$' then
    raise exception 'The transaction ID (TXID) must be 64 hexadecimal characters (or leave it empty).';
  end if;
  update public.withdrawal_requests set status = 'approved', txid = v_txid, reviewed_at = now(), reviewed_by = v_admin
  where id = v_request.id returning * into v_request;
  update public.transactions
  set status = 'completed', description = description || coalesce(' · TXID ' || left(v_txid, 12) || '…', '')
  where withdrawal_request_id = v_request.id and status = 'pending';
  update public.notifications set read_at = now()
  where kind = 'withdrawal_submitted' and read_at is null and (data->>'withdrawalId')::bigint = v_request.id;
  perform igw_private.audit(v_admin, 'withdrawal_approved', 'withdrawal_request', v_request.reference,
    jsonb_build_object('withdrawalId', v_request.id, 'accountNumber', v_request.account_number, 'amountUsd', v_request.amount_usd,
                       'btcAddress', v_request.btc_address, 'txid', v_txid));
  perform igw_private.notify(v_request.user_id, 'withdrawal_approved', 'Withdrawal approved',
    format('Your withdrawal of %s USD has been approved and sent to %s (ref. %s).', v_request.amount_usd, v_request.btc_address, v_request.reference),
    jsonb_build_object('withdrawalId', v_request.id, 'reference', v_request.reference, 'txid', v_txid));
  return jsonb_build_object('ok', true, 'withdrawal', igw_private.admin_withdrawal_row(v_request));
end;
$$;

-- Rejection gives the reserved amount back to the member's balance.
create or replace function public.igw_admin_withdrawal_reject(p_token text, p_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_request public.withdrawal_requests%rowtype;
begin
  if length(v_reason) < 3 then
    raise exception 'Enter a reason for the rejection (sent to the member).';
  end if;
  select * into v_request from public.withdrawal_requests where id = p_id for update;
  if not found then
    raise exception 'Withdrawal request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only pending withdrawals can be rejected (status: %).', v_request.status;
  end if;
  update public.wallets set balance = balance + v_request.amount_usd where user_id = v_request.user_id and currency = 'USD';
  update public.transactions set status = 'failed', description = description || ' · rejected'
  where withdrawal_request_id = v_request.id and status = 'pending';
  update public.withdrawal_requests set status = 'rejected', rejection_reason = v_reason, reviewed_at = now(), reviewed_by = v_admin
  where id = v_request.id returning * into v_request;
  update public.notifications set read_at = now()
  where kind = 'withdrawal_submitted' and read_at is null and (data->>'withdrawalId')::bigint = v_request.id;
  perform igw_private.audit(v_admin, 'withdrawal_rejected', 'withdrawal_request', v_request.reference,
    jsonb_build_object('withdrawalId', v_request.id, 'accountNumber', v_request.account_number, 'amountUsd', v_request.amount_usd,
                       'reason', v_reason));
  perform igw_private.notify(v_request.user_id, 'withdrawal_rejected', 'Withdrawal rejected',
    format('Your withdrawal request was rejected. Reason: %s. %s USD has been returned to your balance (ref. %s).',
           v_reason, v_request.amount_usd, v_request.reference),
    jsonb_build_object('withdrawalId', v_request.id, 'reference', v_request.reference, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'withdrawal', igw_private.admin_withdrawal_row(v_request));
end;
$$;

create or replace function public.igw_admin_card_requests(p_token text, p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
begin
  return coalesce((
    select jsonb_agg(igw_private.card_request_json(r) || jsonb_build_object(
             'currentCard', (select igw_private.card_json(c) from public.member_cards c where c.user_id = r.user_id),
             'email', (select email from public.profiles where id = r.user_id),
             'balance', (select balance from public.wallets x where x.user_id = r.user_id and x.currency = 'USD'),
             'reviewedBy', (select coalesce(username, full_name) from public.profiles where id = r.reviewed_by))
           order by (r.status = 'pending') desc, r.created_at desc, r.id desc)
    from (select * from public.card_requests where p_status is null or status = p_status
          order by (status = 'pending') desc, created_at desc, id desc limit 300) r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.igw_admin_card_request_decide(p_token text, p_id bigint, p_approve boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_request public.card_requests%rowtype;
  v_card public.member_cards%rowtype;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  select * into v_request from public.card_requests where id = p_id for update;
  if not found then
    raise exception 'Card request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This card request has already been decided (status: %).', v_request.status;
  end if;
  update public.notifications set read_at = now()
  where kind = 'card_requested' and read_at is null and (data->>'cardRequestId')::bigint = v_request.id;
  if coalesce(p_approve, false) then
    v_card := igw_private.activate_card(v_admin, v_request.user_id, v_request.tier);
    update public.card_requests set status = 'approved', reviewed_at = now(), reviewed_by = v_admin
    where id = v_request.id returning * into v_request;
    perform igw_private.audit(v_admin, 'card_activated', 'member_card', v_request.account_number,
      jsonb_build_object('tier', v_request.tier, 'requestReference', v_request.reference));
    perform igw_private.notify(v_request.user_id, 'card_activated', 'Card activated',
      format('Your %s card is active. Daily withdrawal limit: %s.', igw_private.card_tier_name(v_request.tier),
             coalesce(igw_private.card_limit(v_request.tier)::text || ' USD', 'unlimited')),
      jsonb_build_object('tier', v_request.tier));
  else
    if length(v_reason) < 3 then
      raise exception 'Enter a reason for the rejection (sent to the member).';
    end if;
    update public.card_requests set status = 'rejected', rejection_reason = v_reason, reviewed_at = now(), reviewed_by = v_admin
    where id = v_request.id returning * into v_request;
    perform igw_private.audit(v_admin, 'card_request_rejected', 'card_request', v_request.reference,
      jsonb_build_object('tier', v_request.tier, 'accountNumber', v_request.account_number, 'reason', v_reason));
    perform igw_private.notify(v_request.user_id, 'card_request_rejected', 'Card request rejected',
      format('Your %s card request was rejected. Reason: %s', igw_private.card_tier_name(v_request.tier), v_reason),
      jsonb_build_object('tier', v_request.tier, 'reason', v_reason));
  end if;
  return jsonb_build_object('ok', true, 'request', igw_private.card_request_json(v_request));
end;
$$;

-- All members that have a card (active or inactive).
create or replace function public.igw_admin_cards(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
begin
  return coalesce((
    select jsonb_agg(igw_private.card_json(c) || jsonb_build_object(
             'userName', p.full_name, 'email', p.email, 'accountNumber', p.account_number,
             'usedLast24h', igw_private.withdrawn_last_24h(c.user_id))
           order by (c.status = 'active') desc, c.updated_at desc)
    from public.member_cards c join public.profiles p on p.id = c.user_id
  ), '[]'::jsonb);
end;
$$;

-- Admin activates, changes or deactivates a member's card directly (by account number).
create or replace function public.igw_admin_set_card(
  p_token text, p_account_number text, p_tier text, p_active boolean, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_profile public.profiles%rowtype;
  v_card public.member_cards%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  select * into v_profile from public.profiles where account_number = regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g');
  if not found then
    raise exception 'No member with this account number.';
  end if;
  if coalesce(p_active, false) then
    if p_tier is null or p_tier not in ('standard', 'gold', 'premium', 'merchant') then
      raise exception 'Choose a card: Standard, Gold, Premium or Merchant.';
    end if;
    v_card := igw_private.activate_card(v_admin, v_profile.id, p_tier);
    -- A pending request is settled by this decision.
    update public.card_requests set status = 'approved', reviewed_at = now(), reviewed_by = v_admin
    where user_id = v_profile.id and status = 'pending' and tier = p_tier;
    perform igw_private.audit(v_admin, 'card_activated', 'member_card', v_profile.account_number, jsonb_build_object('tier', p_tier));
    perform igw_private.notify(v_profile.id, 'card_activated', 'Card activated',
      format('Your %s card is active. Daily withdrawal limit: %s.', igw_private.card_tier_name(p_tier),
             coalesce(igw_private.card_limit(p_tier)::text || ' USD', 'unlimited')),
      jsonb_build_object('tier', p_tier));
  else
    update public.member_cards
    set status = 'inactive', deactivated_at = now(), deactivated_by = v_admin, deactivation_reason = v_reason, updated_at = now()
    where user_id = v_profile.id and status = 'active'
    returning * into v_card;
    if not found then
      raise exception 'This member has no active card.';
    end if;
    perform igw_private.audit(v_admin, 'card_deactivated', 'member_card', v_profile.account_number,
      jsonb_build_object('tier', v_card.tier, 'reason', v_reason));
    perform igw_private.notify(v_profile.id, 'card_deactivated', 'Card deactivated',
      format('Your %s card has been deactivated.%s', igw_private.card_tier_name(v_card.tier), coalesce(' Reason: ' || v_reason, '')),
      jsonb_build_object('tier', v_card.tier, 'reason', v_reason));
  end if;
  return jsonb_build_object('ok', true, 'card', igw_private.card_json(v_card),
                            'member', jsonb_build_object('name', v_profile.full_name, 'accountNumber', v_profile.account_number));
end;
$$;

-- Look up a member by account number (admin "Cards" page).
create or replace function public.igw_admin_member_lookup(p_token text, p_account_number text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where account_number = regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g');
  if not found then
    raise exception 'No member with this account number.';
  end if;
  return jsonb_build_object(
    'name', v_profile.full_name, 'email', v_profile.email, 'accountNumber', v_profile.account_number,
    'balance', (select balance from public.wallets where user_id = v_profile.id and currency = 'USD'),
    'card', (select igw_private.card_json(c) from public.member_cards c where c.user_id = v_profile.id),
    'usedLast24h', igw_private.withdrawn_last_24h(v_profile.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Contact details (igw-rpc-10): public read, admin update.
-- ---------------------------------------------------------------------------
create or replace function public.igw_contact_info()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select igw_private.contact_json();
$$;

create or replace function public.igw_admin_set_contact(p_token text, p_contact jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_email text := trim(coalesce(p_contact->>'email', ''));
  v_phone text := trim(coalesce(p_contact->>'phone', ''));
  v_whatsapp text := trim(coalesce(p_contact->>'whatsapp', ''));
  v_telegram text := trim(coalesce(p_contact->>'telegram', ''));
  v_address text := trim(coalesce(p_contact->>'address', ''));
  v_hours text := trim(coalesce(p_contact->>'hours', ''));
  v_before jsonb := igw_private.contact_json();
  v_key text;
  v_value text;
begin
  if v_email <> '' and (length(v_email) > 120 or v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$') then
    raise exception 'Enter a valid email address (or leave it empty).';
  end if;
  if v_phone <> '' and v_phone !~ '^\+?[0-9][0-9 ()-]{5,24}$' then
    raise exception 'Enter a valid phone number, e.g. +90 555 123 45 67 (or leave it empty).';
  end if;
  if v_whatsapp <> '' and v_whatsapp !~ '^\+?[0-9][0-9 ()-]{5,24}$' then
    raise exception 'Enter the WhatsApp number with country code, e.g. +90 555 123 45 67 (or leave it empty).';
  end if;
  if v_telegram <> '' and v_telegram !~ '^(@?[A-Za-z0-9_]{5,32}|https://t\.me/[A-Za-z0-9_]{5,32})$' then
    raise exception 'Enter a Telegram username (e.g. @igwsupport) or a t.me link (or leave it empty).';
  end if;
  if length(v_address) > 300 then
    raise exception 'The address can be at most 300 characters.';
  end if;
  if length(v_hours) > 120 then
    raise exception 'Working hours can be at most 120 characters.';
  end if;
  for v_key, v_value in
    select * from (values ('contact_email', v_email), ('contact_phone', v_phone), ('contact_whatsapp', v_whatsapp),
                          ('contact_telegram', v_telegram), ('contact_address', v_address), ('contact_hours', v_hours)) x(k, v)
  loop
    insert into public.app_settings (key, value, updated_at, updated_by)
    values (v_key, v_value, now(), v_admin)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = v_admin
    where public.app_settings.value is distinct from excluded.value;
  end loop;
  if (v_before - 'updatedAt') is distinct from (igw_private.contact_json() - 'updatedAt') then
    perform igw_private.audit(v_admin, 'contact_updated', 'setting', 'contact',
      jsonb_build_object('previous', v_before - 'updatedAt', 'new', igw_private.contact_json() - 'updatedAt'));
  end if;
  return igw_private.contact_json();
end;
$$;

revoke all on all functions in schema igw_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
  anon_functions text[] := array[
    'public.igw_health()',
    'public.igw_sign_up(text, text, text)',
    'public.igw_sign_in(text, text)',
    'public.igw_sign_out(text)',
    'public.igw_me(text)',
    'public.igw_dashboard(text)',
    'public.igw_notifications_read(text, bigint[])',
    'public.igw_deposit_submit(text, bigint, text)',
    'public.igw_deposit_cancel(text, bigint)',
    'public.igw_transfer_lookup(text, text)',
    'public.igw_transfer_send(text, text, numeric, uuid, text)',
    'public.igw_admin_overview(text)',
    'public.igw_admin_deposits(text, text, integer)',
    'public.igw_admin_deposit(text, bigint)',
    'public.igw_admin_reject(text, bigint, text)',
    'public.igw_admin_set_method_enabled(text, text, boolean)',
    'public.igw_admin_set_deposit_address(text, text, text)',
    'public.igw_admin_poll(text)',
    'public.igw_withdrawal_center(text)',
    'public.igw_card_request(text, text, text)',
    'public.igw_card_request_cancel(text, bigint)',
    'public.igw_withdrawal_create(text, numeric, text)',
    'public.igw_withdrawal_cancel(text, bigint)',
    'public.igw_admin_withdrawals(text, text)',
    'public.igw_admin_withdrawal_approve(text, bigint, text)',
    'public.igw_admin_withdrawal_reject(text, bigint, text)',
    'public.igw_admin_card_requests(text, text)',
    'public.igw_admin_card_request_decide(text, bigint, boolean, text)',
    'public.igw_admin_cards(text)',
    'public.igw_admin_set_card(text, text, text, boolean, text)',
    'public.igw_admin_member_lookup(text, text)',
    'public.igw_contact_info()',
    'public.igw_admin_set_contact(text, jsonb)',
    'public.igw_admin_approve(text, bigint, numeric)',
    'public.igw_admin_transactions(text, integer)'
  ];
  -- Trusted input (BTC price): callable only with the secret service role key held by the server.
  service_functions text[] := array[
    'public.igw_deposit_create(text, text, numeric, numeric, text)',
    'public.igw_service_ping()'
  ];
begin
  foreach f in array anon_functions || service_functions loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array anon_functions loop
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach f in array anon_functions || service_functions loop
      execute format('grant execute on function %s to service_role', f);
    end loop;
  end if;
end;
$$;

-- Make the API pick up the new functions right away.
notify pgrst, 'reload schema';
