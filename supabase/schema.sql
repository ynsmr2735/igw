-- Insta Global Wallet — Supabase schema
-- Custom auth over the public Supabase API (NEXT_PUBLIC_SUPABASE_URL + ANON_KEY).
--
-- * No Supabase Auth: users live only in public.profiles.
-- * Passwords are bcrypt hashes (pgcrypto) in profiles.password_hash.
-- * Sessions are random tokens; only their SHA-256 hash is stored.
-- * The anon key can NOT touch any table. It can only call the igw_* functions
--   below, which check the password or session token themselves.
-- * Functions that accept trusted data (BTC price / USDT rate, blockchain
--   verification, deposit addresses) can only be called with the secret service role key,
--   which only the server has (SUPABASE_SERVICE_ROLE_KEY).
-- * Admins are listed in public.admin_roles; grant the role in the SQL Editor:
--     select igw_private.grant_admin('admin-email@example.com', 'enkyryyss');
--
-- Run the whole file in the Supabase SQL Editor. It is idempotent and also
-- migrates the earlier versions of this schema in place.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.exchange_rates (
  currency text primary key,
  usd numeric(14, 6) not null,
  label text not null
);

insert into public.exchange_rates (currency, usd, label) values
  ('USD', 1, 'US Dollar'),
  ('EUR', 1.08, 'Euro'),
  ('GBP', 1.27, 'British Pound'),
  ('TRY', 0.026, 'Turkish Lira')
on conflict (currency) do nothing;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null unique,
  password_hash text,
  plan text not null default 'Global Plus',
  created_at timestamptz not null default now()
);

create table if not exists public.wallets (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  currency text not null check (currency in ('USD', 'EUR', 'GBP', 'TRY')),
  name text not null,
  balance numeric(14, 2) not null default 0,
  account_number text not null unique,
  is_primary boolean not null default false
);

create table if not exists public.cards (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  label text not null,
  last4 text not null,
  brand text not null default 'Visa',
  type text not null default 'Virtual card',
  expiry text not null,
  status text not null default 'active',
  theme text not null default 'violet'
);

create table if not exists public.recipients (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  name text not null,
  email text not null,
  currency text not null default 'USD',
  wallet_id bigint references public.wallets(id) on delete set null,
  color text not null default '#7F00FF'
);

create table if not exists public.transactions (
  id bigint generated always as identity primary key,
  wallet_id bigint not null references public.wallets(id) on delete cascade,
  type text not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14, 2) not null,
  currency text not null,
  counterparty text not null,
  note text not null default '',
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

-- expires_at slides forward on activity (idle timeout, 7 days);
-- created_at + 30 days is the absolute limit.
create table if not exists public.sessions (
  token_hash text primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.sessions add column if not exists last_seen_at timestamptz not null default now();

-- Failed sign-in attempts, used to throttle password guessing per email.
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists wallets_user_idx on public.wallets(user_id);
create index if not exists cards_user_idx on public.cards(user_id);
create index if not exists transactions_wallet_idx on public.transactions(wallet_id);
create index if not exists recipients_user_idx on public.recipients(user_id);
create index if not exists sessions_user_idx on public.sessions(user_id);
create index if not exists sessions_expires_idx on public.sessions(expires_at);
create index if not exists login_attempts_email_idx on public.login_attempts(email, attempted_at);
create index if not exists login_attempts_time_idx on public.login_attempts(attempted_at);
create index if not exists profiles_created_idx on public.profiles(created_at);

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
-- Migration from earlier versions (Supabase Auth / direct DATABASE_URL)
-- ---------------------------------------------------------------------------

-- Newer Supabase projects may not let the SQL Editor change auth.users. If so,
-- the old trigger is simply left in place (nothing writes to auth.users any
-- more) instead of aborting the whole script.
do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists on_auth_user_created on auth.users';
  end if;
  drop function if exists public.handle_new_user();
exception
  when others then
    raise notice 'Skipped removing the old auth.users trigger: %', sqlerrm;
end;
$$;

drop function if exists public.execute_wallet_action(
  text, numeric, bigint, bigint, bigint, bigint, text, text
);

do $$
declare
  r record;
begin
  if to_regclass('auth.users') is null then
    return;
  end if;
  for r in
    select c.conname, t.relname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and c.confrelid = to_regclass('auth.users')
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
  end loop;
end;
$$;

alter table public.profiles add column if not exists password_hash text;
alter table public.profiles alter column id set default gen_random_uuid();
update public.profiles set email = lower(email) where email <> lower(email);

-- Hashes written by the previous (Node scrypt) version cannot be checked here.
update public.profiles set password_hash = null
  where password_hash is not null and password_hash not like '$2%';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wallets_user_id_profiles_fkey') then
    alter table public.wallets add constraint wallets_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cards_user_id_profiles_fkey') then
    alter table public.cards add constraint cards_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipients_user_id_profiles_fkey') then
    alter table public.recipients add constraint recipients_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sessions_user_id_profiles_fkey') then
    alter table public.sessions add constraint sessions_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock every table away from the public API
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.cards enable row level security;
alter table public.recipients enable row level security;
alter table public.transactions enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.sessions enable row level security;
alter table public.login_attempts enable row level security;

drop policy if exists "profiles own" on public.profiles;
drop policy if exists "wallets own" on public.wallets;
drop policy if exists "cards own" on public.cards;
drop policy if exists "recipients own" on public.recipients;
drop policy if exists "transactions own" on public.transactions;
drop policy if exists "rates readable" on public.exchange_rates;

revoke all on public.profiles, public.wallets, public.cards, public.recipients,
  public.transactions, public.exchange_rates, public.sessions, public.login_attempts
  from public, anon, authenticated;
alter table public.admin_roles enable row level security;
alter table public.app_settings enable row level security;
alter table public.deposit_requests enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_lookups enable row level security;
alter table public.notifications enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_roles, public.app_settings, public.deposit_requests, public.transfers, public.transfer_lookups, public.notifications, public.admin_audit_log
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private helpers (schema not exposed by the API, not callable with anon key)
-- ---------------------------------------------------------------------------

create schema if not exists igw_private;
revoke all on schema igw_private from public, anon, authenticated;

create or replace function igw_private.token_hash(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create or replace function igw_private.session_user_id(p_token text)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select s.user_id
  from public.sessions s
  where p_token is not null
    and s.token_hash = igw_private.token_hash(p_token)
    and s.expires_at > now()
    and s.created_at > now() - interval '30 days'
  limit 1;
$$;

-- Resolves the session and slides its idle expiry forward (at most once an
-- hour, so normal page views do not write on every request).
create or replace function igw_private.touch_session(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.session_user_id(p_token);
begin
  if v_uid is not null then
    update public.sessions
      set last_seen_at = now(),
          expires_at = least(now() + interval '7 days', created_at + interval '30 days')
      where token_hash = igw_private.token_hash(p_token)
        and last_seen_at < now() - interval '1 hour';
  end if;
  return v_uid;
end;
$$;

create or replace function igw_private.create_session(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text := encode(gen_random_bytes(32), 'hex');
begin
  delete from public.sessions
    where expires_at <= now() or created_at <= now() - interval '30 days';
  insert into public.sessions (token_hash, user_id, expires_at)
    values (igw_private.token_hash(v_token), p_user_id, now() + interval '7 days');
  return v_token;
end;
$$;

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
    'reviewedAt', d.reviewed_at,
    'rejectionReason', d.rejection_reason,
    'verification', d.verification
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

create or replace function public.igw_health()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('ok', true, 'schema', 'igw-rpc-6');
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

-- SERVICE ROLE ONLY + admin session. The admin approves manually, but only a
-- payment verified on its own blockchain right before this call: the server
-- re-checks it, and this function verifies the result matches this exact
-- request (method, address, exact amount, token contract, confirmations).
-- Row lock + status check make a second approval impossible.
create or replace function public.igw_admin_approve(p_token text, p_id bigint, p_verification jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin uuid := igw_private.require_admin(p_token);
  v_request public.deposit_requests%rowtype;
  v_required integer;
  v_wallet public.wallets%rowtype;
begin
  select * into v_request from public.deposit_requests where id = p_id for update;
  if not found then
    raise exception 'Deposit request not found.';
  end if;
  if v_request.status = 'approved' then
    raise exception 'This deposit has already been approved.';
  end if;
  if v_request.status <> 'reviewing' then
    raise exception 'Only deposits under review can be approved (status: %).', replace(v_request.status, '_', ' ');
  end if;
  v_required := igw_private.setting(igw_private.method_key(v_request.method, 'confirmations'))::integer;
  if p_verification is null
     or coalesce((p_verification->>'matched')::boolean, false) is not true
     or p_verification->>'method' is distinct from v_request.method
     or p_verification->>'txid' is distinct from v_request.txid
     or p_verification->>'address' is distinct from v_request.deposit_address
     or coalesce((p_verification->>'paidUnits')::bigint, -1) <> v_request.amount_units
     or coalesce((p_verification->>'confirmations')::integer, 0) < v_required
     or (v_request.method = 'usdt_trc20'
         and p_verification->>'contract' is distinct from 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') then
    raise exception 'Blockchain verification does not match this request. The deposit was not approved.';
  end if;

  update public.wallets
  set balance = balance + v_request.amount_usd
  where user_id = v_request.user_id and currency = 'USD'
  returning * into v_wallet;

  update public.transactions
  set status = 'completed', description = description || ' · TXID ' || left(v_request.txid, 12) || '…'
  where deposit_request_id = v_request.id and status = 'pending';
  if not found then
    insert into public.transactions (
      wallet_id, type, direction, amount, currency, counterparty, note, status,
      reference, description, deposit_request_id
    ) values (
      v_wallet.id, 'deposit', 'in', v_request.amount_usd, 'USD',
      case v_request.method when 'usdt_trc20' then 'Tether (USDT TRC20)' else 'Bitcoin (BTC)' end, '', 'completed',
      v_request.reference,
      igw_private.method_asset(v_request.method) || ' deposit · '
        || igw_private.format_units(v_request.method, v_request.amount_units) || ' ' || igw_private.method_asset(v_request.method),
      v_request.id
    );
  end if;

  update public.deposit_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = v_admin, verification = p_verification
  where id = v_request.id
  returning * into v_request;

  update public.notifications
  set read_at = now()
  where kind = 'deposit_submitted' and read_at is null and (data->>'requestId')::bigint = v_request.id;

  perform igw_private.audit(v_admin, 'deposit_approved', 'deposit_request', v_request.reference,
    jsonb_build_object('requestId', v_request.id, 'method', v_request.method, 'accountNumber', v_request.account_number,
                       'amountUsd', v_request.amount_usd, 'amountUnits', v_request.amount_units,
                       'txid', v_request.txid, 'confirmations', p_verification->'confirmations'));
  perform igw_private.notify(
    v_request.user_id, 'deposit_approved', 'Payment approved',
    format('Your payment has been approved and added to your balance: %s USD (ref. %s).', v_request.amount_usd, v_request.reference),
    jsonb_build_object('requestId', v_request.id, 'reference', v_request.reference, 'amountUsd', v_request.amount_usd)
  );

  return jsonb_build_object('ok', true, 'deposit', igw_private.admin_deposit_row(v_request), 'newBalance', v_wallet.balance);
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
                                    where user_id = v_admin and kind = 'deposit_submitted'),
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
    'public.igw_admin_transactions(text, integer)'
  ];
  -- Trusted inputs (BTC price, blockchain verification, deposit address):
  -- callable only with the secret service role key held by the server.
  service_functions text[] := array[
    'public.igw_deposit_create(text, text, numeric, numeric, text)',
    'public.igw_admin_approve(text, bigint, jsonb)',
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
