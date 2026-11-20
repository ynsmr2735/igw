-- Migration 2026-11-20: auth hardening (schema igw-rpc-1 -> igw-rpc-2)
--
-- For projects that already ran the previous supabase/schema.sql.
-- (Running the full, idempotent supabase/schema.sql again has the same effect.)
--
-- * Sessions: sliding 7-day idle timeout, 30-day absolute limit, global cleanup.
-- * Sign-in: max 5 failed attempts per email per 15 minutes.
-- * Sign-up: global flood guard (20 accounts per minute).
-- * Wallet actions: "not signed in" uses SQLSTATE 28000; amount cap.

alter table public.sessions add column if not exists last_seen_at timestamptz not null default now();

-- Failed sign-in attempts, used to throttle password guessing per email.
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists sessions_expires_idx on public.sessions(expires_at);
create index if not exists login_attempts_email_idx on public.login_attempts(email, attempted_at);
create index if not exists login_attempts_time_idx on public.login_attempts(attempted_at);
create index if not exists profiles_created_idx on public.profiles(created_at);

alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from public, anon, authenticated;

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

revoke all on all functions in schema igw_private from public, anon, authenticated;

create or replace function public.igw_health()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('ok', true, 'schema', 'igw-rpc-2');
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
  -- The anon key is public, so throttle mass account creation.
  if (select count(*) from public.profiles where created_at > now() - interval '1 minute') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'Too many sign-ups right now. Please try again in a minute.');
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
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
  v_hash text;
  v_valid boolean := false;
begin
  -- At most 5 failed attempts per email in 15 minutes (unknown emails too,
  -- so the lockout does not reveal which emails are registered).
  if (select count(*) from public.login_attempts
      where email = v_email and attempted_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error',
      'Too many failed sign-in attempts. Please wait 15 minutes and try again.');
  end if;

  select id, password_hash into v_id, v_hash
  from public.profiles
  where email = v_email;

  if v_hash is not null and v_hash like '$2%' then
    v_valid := crypt(coalesce(p_password, ''), v_hash) = v_hash;
  else
    -- Same work as a real check so timing does not reveal unknown emails.
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));
  end if;

  if not v_valid then
    delete from public.login_attempts where attempted_at < now() - interval '1 day';
    insert into public.login_attempts (email) values (v_email);
    return jsonb_build_object('ok', false, 'error', 'Email or password is incorrect.');
  end if;

  delete from public.login_attempts where email = v_email;
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
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'plan', p.plan)
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
  v_uid uuid := igw_private.touch_session(p_token);
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
    -- SQLSTATE 28000 lets the app tell "not signed in" apart from other errors.
    raise exception using errcode = '28000', message = 'You must be signed in';
  end if;

  if p_action in ('toggleCard', 'toggle_card') then
    select * into v_card from public.cards where id = p_card_id and user_id = v_uid for update;
    if not found then raise exception 'Card not found'; end if;
    update public.cards
      set status = case when status = 'active' then 'frozen' else 'active' end
      where id = v_card.id;
    return jsonb_build_object('ok', true);
  end if;

  if coalesce(p_amount, 0) > 1000000000 then raise exception 'Amount is too large'; end if;
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
