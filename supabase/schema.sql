-- Insta Global Wallet — Supabase schema
-- Run this once in the Supabase SQL Editor, then add the project URL and
-- anon/publishable key to Vercel as NEXT_PUBLIC_SUPABASE_URL and
-- NEXT_PUBLIC_SUPABASE_ANON_KEY.

create extension if not exists pgcrypto;

-- Reference exchange rates (1 unit = USD value). Editable by dashboard owners.
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
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  plan text not null default 'Global Plus',
  created_at timestamptz not null default now()
);

create table if not exists public.wallets (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null check (currency in ('USD', 'EUR', 'GBP', 'TRY')),
  name text not null,
  balance numeric(14, 2) not null default 0,
  account_number text not null unique,
  is_primary boolean not null default false
);

create table if not exists public.cards (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
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
create index if not exists transactions_wallet_idx on public.transactions(wallet_id);
create index if not exists recipients_user_idx on public.recipients(user_id);

-- Row Level Security: a signed-in user can only touch their own rows.
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.cards enable row level security;
alter table public.recipients enable row level security;
alter table public.transactions enable row level security;
alter table public.exchange_rates enable row level security;

drop policy if exists "profiles own" on public.profiles;
create policy "profiles own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "wallets own" on public.wallets;
create policy "wallets own" on public.wallets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cards own" on public.cards;
create policy "cards own" on public.cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "recipients own" on public.recipients;
create policy "recipients own" on public.recipients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "transactions own" on public.transactions;
create policy "transactions own" on public.transactions
  for all using (
    exists (select 1 from public.wallets w where w.id = wallet_id and w.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.wallets w where w.id = wallet_id and w.user_id = auth.uid())
  );

drop policy if exists "rates readable" on public.exchange_rates;
create policy "rates readable" on public.exchange_rates for select to authenticated using (true);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.wallets, public.cards,
  public.recipients, public.transactions, public.exchange_rates to authenticated;
grant usage on all sequences in schema public to authenticated;

-- New signup -> profile + starter wallets + card + saved recipients.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_name text;
  v_suffix text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_suffix := upper(substr(new.id::text, 1, 6));

  insert into public.profiles (id, full_name, email)
  values (new.id, v_name, new.email)
  on conflict (id) do nothing;

  if not exists (select 1 from public.wallets where user_id = new.id) then
    insert into public.wallets (user_id, currency, name, balance, account_number, is_primary) values
      (new.id, 'USD', 'Main account', 1000, 'IGW-USD-' || v_suffix || '-0001', true),
      (new.id, 'EUR', 'Europe account', 0, 'IGW-EUR-' || v_suffix || '-0002', false),
      (new.id, 'GBP', 'UK account', 0, 'IGW-GBP-' || v_suffix || '-0003', false),
      (new.id, 'TRY', 'Turkey account', 0, 'IGW-TRY-' || v_suffix || '-0004', false);
  end if;

  if not exists (select 1 from public.cards where user_id = new.id) then
    insert into public.cards (user_id, label, last4, brand, type, expiry) values
      (new.id, 'IGW Virtual', v_suffix, 'Visa', 'Virtual card', '09/30');
  end if;

  if not exists (select 1 from public.recipients where user_id = new.id) then
    insert into public.recipients (user_id, name, email, currency, color) values
      (new.id, 'Elif Yilmaz', 'elif@example.com', 'USD', '#7F00FF'),
      (new.id, 'Lena Fischer', 'lena@example.com', 'EUR', '#19A2D3'),
      (new.id, 'Daniel Costa', 'daniel@example.com', 'GBP', '#F59E0B');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Atomic wallet actions. Always verifies that the wallet belongs to auth.uid().
create or replace function public.execute_wallet_action(
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
security definer set search_path = public
as $$
declare
  v_wallet public.wallets%rowtype;
  v_target public.wallets%rowtype;
  v_recipient public.recipients%rowtype;
  v_card public.cards%rowtype;
  v_converted numeric(14,2);
  v_from_rate numeric(14,6);
  v_to_rate numeric(14,6);
  v_to_currency text;
  v_pair text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_action = 'toggle_card' then
    select * into v_card from public.cards where id = p_card_id and user_id = auth.uid();
    if not found then raise exception 'Card not found'; end if;
    update public.cards set status = case when status = 'active' then 'frozen' else 'active' end
      where id = v_card.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter a valid amount';
  end if;

  select * into v_wallet from public.wallets where id = p_wallet_id and user_id = auth.uid();
  if not found then raise exception 'Wallet not found'; end if;

  if p_action = 'topup' then
    update public.wallets set balance = balance + p_amount where id = v_wallet.id;
    insert into public.transactions (wallet_id, type, direction, amount, currency, counterparty, note)
      values (v_wallet.id, 'topup', 'in', p_amount, v_wallet.currency,
              coalesce(nullif(p_method, ''), 'Bank card'), coalesce(nullif(p_note, ''), 'Top up'));
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'withdraw' then
    if v_wallet.balance < p_amount then raise exception 'Insufficient balance'; end if;
    update public.wallets set balance = balance - p_amount where id = v_wallet.id;
    insert into public.transactions (wallet_id, type, direction, amount, currency, counterparty, note)
      values (v_wallet.id, 'withdraw', 'out', p_amount, v_wallet.currency,
              coalesce(nullif(p_method, ''), 'Bank account'), coalesce(nullif(p_note, ''), 'Withdrawal'));
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'exchange' then
    select * into v_target from public.wallets where id = p_target_wallet_id and user_id = auth.uid();
    if not found then raise exception 'Invalid target wallet'; end if;
    if v_target.id = v_wallet.id then raise exception 'Choose a different wallet'; end if;
    if v_wallet.balance < p_amount then raise exception 'Insufficient balance'; end if;

    v_from_rate := coalesce((select usd from public.exchange_rates where currency = v_wallet.currency), 1);
    v_to_rate := coalesce((select usd from public.exchange_rates where currency = v_target.currency), 1);
    v_converted := round(p_amount * v_from_rate / v_to_rate, 2);
    v_pair := v_wallet.currency || ' → ' || v_target.currency;

    update public.wallets set balance = balance - p_amount where id = v_wallet.id;
    update public.wallets set balance = balance + v_converted where id = v_target.id;
    insert into public.transactions (wallet_id, type, direction, amount, currency, counterparty, note) values
      (v_wallet.id, 'exchange', 'out', p_amount, v_wallet.currency, v_pair, 'Currency exchange'),
      (v_target.id, 'exchange', 'in', v_converted, v_target.currency, v_pair, 'Currency exchange');
    return jsonb_build_object('ok', true, 'converted_amount', v_converted);
  end if;

  if p_action = 'send' then
    select * into v_recipient from public.recipients where id = p_recipient_id and user_id = auth.uid();
    if not found then raise exception 'Recipient not found'; end if;
    if v_wallet.balance < p_amount then raise exception 'Insufficient balance'; end if;

    v_to_currency := v_recipient.currency;
    v_from_rate := coalesce((select usd from public.exchange_rates where currency = v_wallet.currency), 1);
    v_to_rate := coalesce((select usd from public.exchange_rates where currency = v_to_currency), 1);
    v_converted := round(p_amount * v_from_rate / v_to_rate, 2);

    update public.wallets set balance = balance - p_amount where id = v_wallet.id;
    if v_recipient.wallet_id is not null then
      update public.wallets set balance = balance + v_converted where id = v_recipient.wallet_id;
    end if;

    insert into public.transactions (wallet_id, type, direction, amount, currency, counterparty, note)
      values (v_wallet.id, 'transfer', 'out', p_amount, v_wallet.currency, v_recipient.name, p_note);
    if v_recipient.wallet_id is not null then
      insert into public.transactions (wallet_id, type, direction, amount, currency, counterparty, note)
        values (v_recipient.wallet_id, 'transfer', 'in', v_converted, v_to_currency,
                (select full_name from public.profiles where id = auth.uid()), p_note);
    end if;
    return jsonb_build_object('ok', true, 'converted_amount', v_converted);
  end if;

  raise exception 'Unknown action';
end;
$$;

revoke all on function public.execute_wallet_action(
  text, numeric, bigint, bigint, bigint, bigint, text, text
) from public;
grant execute on function public.execute_wallet_action(
  text, numeric, bigint, bigint, bigint, bigint, text, text
) to authenticated;
