-- ============================================================================
-- DigiPlus AI — multi-tenant database schema (v3: messaging channels)
-- Run in Supabase: SQL Editor → New query → paste this file → Run.
-- Safe to run again: it only creates what is missing and replaces functions.
-- Existing single-bot data is moved into an account by migrate-legacy.sql.
-- ============================================================================

-- ---------------------------------------------------------------- accounts & bots
create table if not exists public.accounts (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null default 'My business',
  owner_id             uuid references auth.users (id) on delete set null,
  owner_email          text,
  claim_email          text,          -- account prepared for someone who has not signed up yet
  plan                 text not null default 'trial' check (plan in ('trial', 'starter', 'pro', 'business')),
  plan_expires_at      timestamptz,   -- paid plan ends here; null on a paid plan = no expiry (complimentary)
  billing_provider     text not null default 'none' check (billing_provider in ('none', 'manual', 'dodo')),
  extra_bots           int not null default 0 check (extra_bots >= 0),
  dodo_customer_id     text,
  dodo_subscription_id text,
  dodo_status          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists accounts_owner_idx on public.accounts (owner_id) where owner_id is not null;
create index if not exists accounts_claim_email_idx on public.accounts (lower(claim_email)) where claim_email is not null;
create index if not exists accounts_dodo_subscription_idx on public.accounts (dodo_subscription_id) where dodo_subscription_id is not null;

create table if not exists public.account_members (
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index if not exists account_members_user_idx on public.account_members (user_id);

create table if not exists public.bots (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  public_id  text not null unique,     -- used in the public chat link and widget
  name       text not null,
  settings   jsonb not null default '{}'::jsonb,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bots_account_idx on public.bots (account_id, created_at);

-- ---------------------------------------------------------------- messaging channels
-- One row per connected Facebook Page, Instagram account or WhatsApp number.
create table if not exists public.channel_connections (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  bot_id           uuid not null references public.bots (id) on delete cascade,
  channel          text not null check (channel in ('messenger', 'instagram', 'whatsapp')),
  external_id      text not null,       -- Page ID, Instagram account ID or WhatsApp phone number ID
  name             text,                -- Page name, @username or phone number
  mode             text not null default 'platform' check (mode in ('platform', 'own_app')),
  hook_id          text unique,         -- own_app: webhook URL segment
  verify_token     text,                -- own_app: webhook verify token
  access_token_enc text not null,       -- AES-256-GCM encrypted
  app_secret_enc   text,                -- own_app only, encrypted
  meta             jsonb not null default '{}'::jsonb,
  auto_reply       boolean not null default true,
  status           text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  last_error       text,
  last_event_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists channel_connections_asset_idx on public.channel_connections (channel, external_id) where status <> 'disconnected';
create index if not exists channel_connections_bot_idx on public.channel_connections (bot_id, created_at);

-- ---------------------------------------------------------------- conversations & messages
create table if not exists public.conversations (
  id                     uuid primary key default gen_random_uuid(),
  bot_id                 uuid references public.bots (id) on delete cascade,
  token                  text not null,
  channel                text not null default 'web' check (channel in ('web', 'messenger', 'instagram', 'whatsapp')),
  connection_id          uuid references public.channel_connections (id) on delete set null,
  external_user_id       text,          -- WhatsApp number / Messenger PSID / Instagram IGSID
  bot_paused             boolean not null default false,  -- a human took over
  client_name            text,
  client_contact         text,
  source                 text,
  ip                     text,
  status                 text not null default 'open' check (status in ('open', 'closed')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  last_client_message_at timestamptz,
  message_count          int not null default 0,
  summary                jsonb,
  summary_at             timestamptz,   -- summary covers messages up to this time
  summary_message_count  int,           -- message_count when the summary was made
  summary_started_at     timestamptz,   -- lock so two servers don't summarize at once
  summary_failed_at      timestamptz,
  summary_error          text,
  stage                  text,
  deal_likelihood        int,
  admin_notes            text
);

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  sender          text check (sender in ('client', 'bot', 'human')),
  content         text not null,
  external_id     text,          -- channel message id (Meta sometimes delivers twice)
  send_error      text,          -- set when delivery to the channel failed
  provider        text,
  model           text,
  input_tokens    int,
  cached_tokens   int,
  output_tokens   int,
  cost_usd        numeric(12, 6),
  created_at      timestamptz not null default now()
);

-- Upgrades from older versions (no-ops on a fresh database).
drop function if exists public.admin_list_conversations(text, text, text, int);
drop function if exists public.admin_list_conversations(text, text, text, text, int);
drop function if exists public.admin_stats();
drop function if exists public.list_conversations(uuid, text, text, text, int);
alter table public.conversations add column if not exists bot_id uuid references public.bots (id) on delete cascade;
alter table public.conversations add column if not exists summary_message_count int;
alter table public.conversations add column if not exists channel text not null default 'web';
alter table public.conversations add column if not exists connection_id uuid references public.channel_connections (id) on delete set null;
alter table public.conversations add column if not exists external_user_id text;
alter table public.conversations add column if not exists bot_paused boolean not null default false;
alter table public.conversations add column if not exists last_client_message_at timestamptz;
alter table public.conversations drop column if exists external_id;
drop index if exists public.conversations_channel_user_idx;
alter table public.messages add column if not exists sender text check (sender in ('client', 'bot', 'human'));
alter table public.messages add column if not exists external_id text;
alter table public.messages add column if not exists send_error text;
alter table public.messages add column if not exists input_tokens int;
alter table public.messages add column if not exists cached_tokens int;
alter table public.messages add column if not exists output_tokens int;
alter table public.messages add column if not exists cost_usd numeric(12, 6);

do $$
begin
  if not exists (select 1 from public.conversations where bot_id is null) then
    alter table public.conversations alter column bot_id set not null;
  end if;
end $$;

create index if not exists conversations_bot_updated_idx on public.conversations (bot_id, updated_at desc);
create unique index if not exists conversations_bot_channel_user_idx on public.conversations (bot_id, channel, external_user_id) where external_user_id is not null;
create index if not exists messages_conversation_idx on public.messages (conversation_id, id);
create unique index if not exists messages_external_idx on public.messages (external_id) where external_id is not null;
drop index if exists public.conversations_updated_idx;
drop index if exists public.conversations_stage_idx;

create or replace function public.touch_conversation_on_message()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.conversations
     set message_count = message_count + 1,
         updated_at    = new.created_at
   where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- ---------------------------------------------------------------- usage & billing
create table if not exists public.usage_monthly (
  account_id    uuid not null references public.accounts (id) on delete cascade,
  period        text not null,              -- 'YYYY-MM' in UTC
  replies       int not null default 0,     -- AI replies counted against the plan
  bonus_replies int not null default 0,     -- reply packs bought for this month
  summaries     int not null default 0,
  input_tokens  bigint not null default 0,
  cached_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd      numeric(14, 6) not null default 0,
  limit_hit_at  timestamptz,
  primary key (account_id, period)
);

create table if not exists public.payment_requests (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  plan        text check (plan is null or plan in ('starter', 'pro', 'business')),
  months      int not null default 1 check (months between 1 and 12),
  extra_bots  int not null default 0 check (extra_bots between 0 and 50),
  reply_packs int not null default 0 check (reply_packs between 0 and 100),
  amount      numeric(10, 3) not null check (amount >= 0),
  currency    text not null default 'TND',
  method      text not null check (method in ('d17', 'bank', 'cash', 'other')),
  reference   text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note  text,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists payment_requests_status_idx on public.payment_requests (status, created_at desc);
create index if not exists payment_requests_account_idx on public.payment_requests (account_id, created_at desc);

create table if not exists public.platform_settings (
  id         int primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id           text primary key,     -- webhook-id header (deduplicates retries)
  provider     text not null,
  type         text,
  payload      jsonb,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

-- ---------------------------------------------------------------- security
-- RLS on, no policies: only the server (service_role key) can read or write.
alter table public.accounts            enable row level security;
alter table public.account_members     enable row level security;
alter table public.bots                enable row level security;
alter table public.channel_connections enable row level security;
alter table public.conversations       enable row level security;
alter table public.messages            enable row level security;
alter table public.usage_monthly       enable row level security;
alter table public.payment_requests    enable row level security;
alter table public.platform_settings   enable row level security;
alter table public.webhook_events      enable row level security;

-- ---------------------------------------------------------------- functions
-- Atomically counts one AI reply if the account is still under its monthly limit.
create or replace function public.consume_reply(p_account uuid, p_period text, p_limit int)
returns boolean language plpgsql set search_path = public as $$
begin
  insert into public.usage_monthly (account_id, period) values (p_account, p_period) on conflict do nothing;
  update public.usage_monthly
     set replies = replies + 1
   where account_id = p_account and period = p_period and replies < p_limit + bonus_replies;
  if found then
    return true;
  end if;
  update public.usage_monthly
     set limit_hit_at = coalesce(limit_hit_at, now())
   where account_id = p_account and period = p_period;
  return false;
end $$;

-- Gives the reply back when the AI call failed (the client got no answer).
create or replace function public.release_reply(p_account uuid, p_period text)
returns void language sql set search_path = public as $$
  update public.usage_monthly
     set replies = greatest(replies - 1, 0)
   where account_id = p_account and period = p_period;
$$;

create or replace function public.record_ai_usage(
  p_account uuid, p_period text, p_input int, p_cached int, p_output int, p_cost numeric, p_is_summary boolean default false
)
returns void language sql set search_path = public as $$
  insert into public.usage_monthly (account_id, period, input_tokens, cached_tokens, output_tokens, cost_usd, summaries)
  values (p_account, p_period, p_input, p_cached, p_output, p_cost, case when p_is_summary then 1 else 0 end)
  on conflict (account_id, period) do update set
    input_tokens  = public.usage_monthly.input_tokens  + excluded.input_tokens,
    cached_tokens = public.usage_monthly.cached_tokens + excluded.cached_tokens,
    output_tokens = public.usage_monthly.output_tokens + excluded.output_tokens,
    cost_usd      = public.usage_monthly.cost_usd      + excluded.cost_usd,
    summaries     = public.usage_monthly.summaries     + excluded.summaries;
$$;

create or replace function public.add_bonus_replies(p_account uuid, p_period text, p_replies int)
returns void language sql set search_path = public as $$
  insert into public.usage_monthly (account_id, period, bonus_replies)
  values (p_account, p_period, p_replies)
  on conflict (account_id, period) do update set
    bonus_replies = public.usage_monthly.bonus_replies + excluded.bonus_replies,
    limit_hit_at  = null;
$$;

create or replace function public.list_conversations(
  p_bot uuid, p_q text default null, p_status text default null, p_stage text default null,
  p_channel text default null, p_limit int default 300
)
returns table (
  id uuid, client_name text, client_contact text, source text, status text, channel text, bot_paused boolean,
  created_at timestamptz, updated_at timestamptz, last_client_message_at timestamptz, message_count int,
  stage text, deal_likelihood int, summary_at timestamptz, headline text
)
language sql stable set search_path = public as $$
  select c.id, c.client_name, c.client_contact, c.source, c.status, c.channel, c.bot_paused,
         c.created_at, c.updated_at, c.last_client_message_at, c.message_count,
         c.stage, c.deal_likelihood, c.summary_at, c.summary ->> 'headline'
    from public.conversations c
   where c.bot_id = p_bot
     and c.message_count > 0
     and (coalesce(p_status, '')  = '' or c.status  = p_status)
     and (coalesce(p_stage, '')   = '' or c.stage   = p_stage)
     and (coalesce(p_channel, '') = '' or c.channel = p_channel)
     and (coalesce(p_q, '') = ''
          or c.client_name    ilike '%' || p_q || '%'
          or c.client_contact ilike '%' || p_q || '%'
          or c.admin_notes    ilike '%' || p_q || '%'
          or c.summary::text  ilike '%' || p_q || '%'
          or exists (select 1 from public.messages m
                      where m.conversation_id = c.id and m.content ilike '%' || p_q || '%'))
   order by c.updated_at desc
   limit p_limit;
$$;

create or replace function public.bot_stats(p_bot uuid)
returns json language sql stable set search_path = public as $$
  select json_build_object(
    'total',         count(*),
    'last7days',     count(*) filter (where created_at >= now() - interval '7 days'),
    'open',          count(*) filter (where status = 'open'),
    'hotLeads',      count(*) filter (where deal_likelihood >= 70),
    'readyToBuy',    count(*) filter (where stage = 'ready_to_buy'),
    'avgLikelihood', round(avg(deal_likelihood))
  )
  from public.conversations
  where bot_id = p_bot and message_count > 0;
$$;

-- Idle conversations with no summary yet, or at least 4 new messages since the last one.
drop function if exists public.conversations_needing_summary(timestamptz, int);
create or replace function public.conversations_needing_summary(p_idle_since timestamptz, p_limit int default 3)
returns table (id uuid, bot_id uuid)
language sql stable set search_path = public as $$
  select c.id, c.bot_id
    from public.conversations c
   where c.message_count > 1
     and c.updated_at < p_idle_since
     and (c.summary_at is null
          or (c.summary_at < c.updated_at and c.message_count - coalesce(c.summary_message_count, 0) >= 4))
     and (c.summary_started_at is null or c.summary_started_at < now() - interval '3 minutes')
     and (c.summary_failed_at  is null or c.summary_failed_at  < now() - interval '30 minutes')
   order by c.updated_at asc
   limit p_limit;
$$;

create or replace function public.claim_summary(p_id uuid)
returns boolean language plpgsql set search_path = public as $$
begin
  update public.conversations
     set summary_started_at = now()
   where id = p_id
     and (summary_started_at is null or summary_started_at < now() - interval '3 minutes');
  return found;
end $$;

create or replace function public.super_accounts(p_period text)
returns table (
  id uuid, name text, owner_email text, claim_email text, plan text, plan_expires_at timestamptz,
  billing_provider text, extra_bots int, created_at timestamptz,
  bots bigint, conversations bigint,
  replies int, bonus_replies int, summaries int, cost_usd numeric, limit_hit_at timestamptz
)
language sql stable set search_path = public as $$
  select a.id, a.name, a.owner_email, a.claim_email, a.plan, a.plan_expires_at,
         a.billing_provider, a.extra_bots, a.created_at,
         (select count(*) from public.bots b where b.account_id = a.id),
         (select count(*) from public.conversations c join public.bots b on b.id = c.bot_id
           where b.account_id = a.id and c.message_count > 0),
         coalesce(u.replies, 0), coalesce(u.bonus_replies, 0), coalesce(u.summaries, 0),
         coalesce(u.cost_usd, 0), u.limit_hit_at
    from public.accounts a
    left join public.usage_monthly u on u.account_id = a.id and u.period = p_period
   order by a.created_at desc;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.consume_reply(uuid, text, int)',
    'public.release_reply(uuid, text)',
    'public.record_ai_usage(uuid, text, int, int, int, numeric, boolean)',
    'public.add_bonus_replies(uuid, text, int)',
    'public.list_conversations(uuid, text, text, text, text, int)',
    'public.bot_stats(uuid)',
    'public.conversations_needing_summary(timestamptz, int)',
    'public.claim_summary(uuid)',
    'public.super_accounts(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
