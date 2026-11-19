-- Insta Global Wallet — Supabase schema
-- Custom auth over the public Supabase API (NEXT_PUBLIC_SUPABASE_URL + ANON_KEY).
--
-- * No Supabase Auth: users live only in public.profiles.
-- * Passwords are bcrypt hashes (pgcrypto) in profiles.password_hash.
-- * Sessions are random tokens; only their SHA-256 hash is stored.
-- * The anon key can NOT touch any table. It can only call the igw_* functions
--   below, which check the password or session token themselves.
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

create table if not exists public.sessions (
  token_hash text primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists wallets_user_idx on public.wallets(user_id);
create index if not exists cards_user_idx on public.cards(user_id);
create index if not exists transactions_wallet_idx on public.transactions(wallet_id);
create index if not exists recipients_user_idx on public.recipients(user_id);
create index if not exists sessions_user_idx on public.sessions(user_id);

-- ---------------------------------------------------------------------------
-- Migration from earlier versions (Supabase Auth / direct DATABASE_URL)
-- ---------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
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

drop policy if exists "profiles own" on public.profiles;
drop policy if exists "wallets own" on public.wallets;
drop policy if exists "cards own" on public.cards;
drop policy if exists "recipients own" on public.recipients;
drop policy if exists "transactions own" on public.transactions;
drop policy if exists "rates readable" on public.exchange_rates;

revoke all on public.profiles, public.wallets, public.cards, public.recipients,
  public.transactions, public.exchange_rates, public.sessions
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
  limit 1;
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
  delete from public.sessions where user_id = p_user_id and expires_at <= now();
  insert into public.sessions (token_hash, user_id, expires_at)
    values (igw_private.token_hash(v_token), p_user_id, now() + interval '7 days');
  return v_token;
end;
$$;

create or replace function igw_private.provision_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_suffix text := upper(substr(replace(p_user_id::text, '-', ''), 1, 12));
  v_last4 text := lpad((floor(random() * 10000))::int::text, 4, '0');
begin
  insert into public.wallets (user_id, currency, name, balance, account_number, is_primary) values
    (p_user_id, 'USD', 'Main account', 1000, 'IGW-USD-' || v_suffix || '-0001', true),
    (p_user_id, 'EUR', 'Europe account', 0, 'IGW-EUR-' || v_suffix || '-0002', false),
    (p_user_id, 'GBP', 'UK account', 0, 'IGW-GBP-' || v_suffix || '-0003', false),
    (p_user_id, 'TRY', 'Turkey account', 0, 'IGW-TRY-' || v_suffix || '-0004', false);

  insert into public.cards (user_id, label, last4, brand, type, expiry, status, theme) values
    (p_user_id, 'IGW Virtual', v_last4, 'Visa', 'Virtual card', '09/30', 'active', 'violet');

  insert into public.recipients (user_id, name, email, currency, color) values
    (p_user_id, 'Elif Yilmaz', 'elif@example.com', 'USD', '#7F00FF'),
    (p_user_id, 'Lena Fischer', 'lena@example.com', 'EUR', '#19A2D3'),
    (p_user_id, 'Daniel Costa', 'daniel@example.com', 'GBP', '#F59E0B');
end;
$$;

revoke all on all functions in schema igw_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public API (callable with the anon key)
-- ---------------------------------------------------------------------------

create or replace function public.igw_health()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('ok', true, 'schema', 'igw-rpc-1');
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

  insert into public.profiles (full_name, email, password_hash)
    values (v_name, v_email, crypt(v_password, gen_salt('bf', 10)))
    returning id into v_id;

  perform igw_private.provision_user(v_id);

  return jsonb_build_object('ok', true, 'token', igw_private.create_session(v_id));
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'An account with this email already exists. Please sign in.');
end;
$$;

create or replace function public.igw_sign_in(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_hash text;
begin
  select id, password_hash into v_id, v_hash
  from public.profiles
  where email = lower(trim(coalesce(p_email, '')));

  if v_hash is null or v_hash not like '$2%' then
    -- Same work as a real check so timing does not reveal unknown emails.
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));
    return jsonb_build_object('ok', false, 'error', 'Email or password is incorrect.');
  end if;

  if crypt(coalesce(p_password, ''), v_hash) <> v_hash then
    return jsonb_build_object('ok', false, 'error', 'Email or password is incorrect.');
  end if;

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
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'plan', p.plan)
  from public.profiles p
  where p.id = igw_private.session_user_id(p_token);
$$;

create or replace function public.igw_dashboard(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.session_user_id(p_token);
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'You must be signed in');
  end if;

  return jsonb_build_object(
    'ok', true,
    'user', (
      select jsonb_build_object('name', full_name, 'email', email, 'plan', plan)
      from public.profiles where id = v_uid
    ),
    'wallets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'currency', w.currency, 'name', w.name, 'balance', w.balance,
        'accountNumber', w.account_number, 'isPrimary', w.is_primary
      ) order by w.id)
      from public.wallets w where w.user_id = v_uid
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'type', t.type, 'direction', t.direction, 'amount', t.amount,
        'currency', t.currency, 'counterparty', t.counterparty, 'note', t.note,
        'status', t.status, 'createdAt', t.created_at
      ) order by t.created_at desc, t.id desc)
      from (
        select tx.*
        from public.transactions tx
        join public.wallets w on w.id = tx.wallet_id
        where w.user_id = v_uid
        order by tx.created_at desc, tx.id desc
        limit 30
      ) t
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'label', c.label, 'last4', c.last4, 'brand', c.brand, 'type', c.type,
        'expiry', c.expiry, 'status', c.status, 'theme', c.theme
      ) order by c.id)
      from public.cards c where c.user_id = v_uid
    ), '[]'::jsonb),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'email', r.email, 'currency', r.currency,
        'color', r.color, 'walletId', r.wallet_id
      ) order by r.id)
      from public.recipients r where r.user_id = v_uid
    ), '[]'::jsonb),
    'flows', (
      select jsonb_build_object(
        'moneyIn', coalesce(sum(t.amount * coalesce(er.usd, 1)) filter (where t.direction = 'in'), 0),
        'moneyOut', coalesce(sum(t.amount * coalesce(er.usd, 1)) filter (where t.direction = 'out'), 0)
      )
      from public.transactions t
      join public.wallets w on w.id = t.wallet_id
      left join public.exchange_rates er on er.currency = t.currency
      where w.user_id = v_uid and t.created_at >= now() - interval '30 days'
    )
  );
end;
$$;

-- Atomic wallet actions. Ownership is checked through the session token.
create or replace function public.igw_wallet_action(
  p_token text,
  p_action text,
  p_amount numeric default 0,
  p_wallet_id bigint default null,
  p_target_wallet_id bigint default null,
  p_recipient_id bigint default null,
  p_card_id bigint default null,
  p_note text default '',
  p_method text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := igw_private.session_user_id(p_token);
  v_amount numeric(14, 2);
  v_note text := left(coalesce(p_note, ''), 200);
  v_wallet public.wallets%rowtype;
  v_target public.wallets%rowtype;
  v_recipient public.recipients%rowtype;
  v_card public.cards%rowtype;
  v_converted numeric(14, 2);
  v_from_rate numeric;
  v_to_rate numeric;
  v_pair text;
begin
  if v_uid is null then
    raise exception 'You must be signed in';
  end if;

  if p_action in ('toggleCard', 'toggle_card') then
    select * into v_card from public.cards where id = p_card_id and user_id = v_uid for update;
    if not found then raise exception 'Card not found'; end if;
    update public.cards
      set status = case when status = 'active' then 'frozen' else 'active' end
      where id = v_card.id;
    return jsonb_build_object('ok', true);
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then raise exception 'Enter a valid amount'; end if;

  if p_action = 'send' then
    select * into v_recipient from public.recipients where id = p_recipient_id and user_id = v_uid;
    if not found then raise exception 'Recipient not found'; end if;

    select * into v_wallet from public.wallets
      where user_id = v_uid
        and (id = p_wallet_id or (p_wallet_id is null and currency = v_recipient.currency))
      order by id
      limit 1
      for update;
    if not found then raise exception 'Wallet not found'; end if;
    if v_wallet.balance < v_amount then raise exception 'Insufficient balance'; end if;

    v_from_rate := coalesce((select usd from public.exchange_rates where currency = v_wallet.currency), 1);
    v_to_rate := coalesce((select usd from public.exchange_rates where currency = v_recipient.currency), 1);
    v_converted := round(v_amount * v_from_rate / v_to_rate, 2);

    update public.wallets set balance = balance - v_amount where id = v_wallet.id;
    insert into public.transactions (wallet_id, type, direction, amount, currency, counterparty, note)
      values (v_wallet.id, 'transfer', 'out', v_amount, v_wallet.currency, v_recipient.name, v_note);

    if v_recipient.wallet_id is not null then
      update public.wallets set balance = balance + v_converted where id = v_recipient.wallet_id;
      insert into public.transactions (wallet_id, type, direction, amount, currency, counterparty, note)
        values (v_recipient.wallet_id, 'transfer', 'in', v_converted, v_recipient.currency,
                (select full_name from public.profiles where id = v_uid), v_note);
    end if;
    return jsonb_build_object('ok', true, 'converted_amount', v_converted);
  end if;

  select * into v_wallet from public.wallets where id = p_wallet_id and user_id = v_uid for update;
  if not found then raise exception 'Wallet not found'; end if;

  if p_action = 'topup' then
    update public.wallets set balance = balance + v_amount where id = v_wallet.id;
    insert into public.transactions (wallet_id, type, direction, amount, currency, counterparty, note)
      values (v_wallet.id, 'topup', 'in', v_amount, v_wallet.currency,
              coalesce(nullif(left(p_method, 80), ''), 'Bank card'), coalesce(nullif(v_note, ''), 'Top up'));
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'withdraw' then
    if v_wallet.balance < v_amount then raise exception 'Insufficient balance'; end if;
    update public.wallets set balance = balance - v_amount where id = v_wallet.id;
    insert into public.transactions (wallet_id, type, direction, amount, currency, counterparty, note)
      values (v_wallet.id, 'withdraw', 'out', v_amount, v_wallet.currency,
              coalesce(nullif(left(p_method, 80), ''), 'Bank account'), coalesce(nullif(v_note, ''), 'Withdrawal'));
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'exchange' then
    select * into v_target from public.wallets
      where id = p_target_wallet_id and user_id = v_uid
      for update;
    if not found or v_target.id = v_wallet.id then raise exception 'Invalid target wallet'; end if;
    if v_wallet.balance < v_amount then raise exception 'Insufficient balance'; end if;

    v_from_rate := coalesce((select usd from public.exchange_rates where currency = v_wallet.currency), 1);
    v_to_rate := coalesce((select usd from public.exchange_rates where currency = v_target.currency), 1);
    v_converted := round(v_amount * v_from_rate / v_to_rate, 2);
    v_pair := v_wallet.currency || ' → ' || v_target.currency;

    update public.wallets set balance = balance - v_amount where id = v_wallet.id;
    update public.wallets set balance = balance + v_converted where id = v_target.id;
    insert into public.transactions (wallet_id, type, direction, amount, currency, counterparty, note) values
      (v_wallet.id, 'exchange', 'out', v_amount, v_wallet.currency, v_pair, 'Currency exchange'),
      (v_target.id, 'exchange', 'in', v_converted, v_target.currency, v_pair, 'Currency exchange');
    return jsonb_build_object('ok', true, 'converted_amount', v_converted);
  end if;

  raise exception 'Unknown action';
end;
$$;

-- Only these functions are reachable with the anon key.
revoke all on function public.igw_health() from public;
revoke all on function public.igw_sign_up(text, text, text) from public;
revoke all on function public.igw_sign_in(text, text) from public;
revoke all on function public.igw_sign_out(text) from public;
revoke all on function public.igw_me(text) from public;
revoke all on function public.igw_dashboard(text) from public;
revoke all on function public.igw_wallet_action(text, text, numeric, bigint, bigint, bigint, bigint, text, text) from public;

grant execute on function public.igw_health() to anon, authenticated;
grant execute on function public.igw_sign_up(text, text, text) to anon, authenticated;
grant execute on function public.igw_sign_in(text, text) to anon, authenticated;
grant execute on function public.igw_sign_out(text) to anon, authenticated;
grant execute on function public.igw_me(text) to anon, authenticated;
grant execute on function public.igw_dashboard(text) to anon, authenticated;
grant execute on function public.igw_wallet_action(text, text, numeric, bigint, bigint, bigint, bigint, text, text) to anon, authenticated;

-- Make the API pick up the new functions right away.
notify pgrst, 'reload schema';
