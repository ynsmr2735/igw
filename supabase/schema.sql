-- Insta Global Wallet — Supabase schema (custom auth, no Supabase Auth)
--
-- Users live only in public.profiles. Passwords are stored as scrypt hashes in
-- profiles.password_hash. The Next.js server talks to this database directly
-- through DATABASE_URL (server-side only), so no auth.users rows, no email
-- confirmation and no RLS policies based on auth.uid() are needed.
--
-- Safe to run on a fresh project AND on a project that already ran the old
-- Supabase-Auth version of this file: it is idempotent and migrates in place.

create extension if not exists pgcrypto;

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

create index if not exists wallets_user_idx on public.wallets(user_id);
create index if not exists cards_user_idx on public.cards(user_id);
create index if not exists transactions_wallet_idx on public.transactions(wallet_id);
create index if not exists recipients_user_idx on public.recipients(user_id);

-- ---------------------------------------------------------------------------
-- Migration from the old Supabase-Auth schema
-- ---------------------------------------------------------------------------

-- Old signup trigger and RPC depended on auth.users / auth.uid().
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.execute_wallet_action(
  text, numeric, bigint, bigint, bigint, bigint, text, text
);

-- Remove every foreign key that points at auth.users.
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

-- Emails are compared in lower case by the app.
update public.profiles set email = lower(email) where email <> lower(email);

-- Owner rows now reference public.profiles instead of auth.users.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wallets_user_id_profiles_fkey') then
    alter table public.wallets
      add constraint wallets_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cards_user_id_profiles_fkey') then
    alter table public.cards
      add constraint cards_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipients_user_id_profiles_fkey') then
    alter table public.recipients
      add constraint recipients_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock the tables away from the public Supabase API
-- ---------------------------------------------------------------------------
-- Only the server (connecting as the postgres role via DATABASE_URL) may read
-- or write. RLS stays on with no policies, and the anon / authenticated roles
-- lose their grants, so the anon key can never read profiles.password_hash.

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.cards enable row level security;
alter table public.recipients enable row level security;
alter table public.transactions enable row level security;
alter table public.exchange_rates enable row level security;

drop policy if exists "profiles own" on public.profiles;
drop policy if exists "wallets own" on public.wallets;
drop policy if exists "cards own" on public.cards;
drop policy if exists "recipients own" on public.recipients;
drop policy if exists "transactions own" on public.transactions;
drop policy if exists "rates readable" on public.exchange_rates;

revoke all on public.profiles, public.wallets, public.cards,
  public.recipients, public.transactions, public.exchange_rates
  from anon, authenticated;
