-- DigiPlus AI — web chat. One conversation per visitor per assistant, its messages,
-- and what the assistant saved (a client's details or a booking request).
-- Only the server reads and writes these (service role): RLS is on and there are no policies.

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  bot        text not null,              -- which assistant: clim-express, yasmine-photo, digiplus
  visitor_id uuid not null,              -- random id kept in the visitor's browser
  ip_hash    text,                       -- to limit abuse; never the IP itself
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bot, visitor_id)
);

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role            text not null check (role in ('client', 'bot')),
  text            text not null default '',
  card            jsonb,                 -- a card shown in the chat (details saved, time slots…)
  batch           uuid,                  -- client messages sent together: a retried send is stored once
  created_at      timestamptz not null default now()
);

create table if not exists public.requests (
  id              uuid primary key default gen_random_uuid(),
  bot             text not null,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  kind            text not null check (kind in ('details', 'booking')),
  data            jsonb not null,
  starts_at       timestamptz,           -- bookings only
  status          text not null default 'new' check (status in ('new', 'pending', 'confirmed', 'declined', 'done')),
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, id);
create index if not exists messages_batch_idx on public.messages (batch) where batch is not null;
create index if not exists conversations_ip_idx on public.conversations (ip_hash, updated_at);
create index if not exists requests_bot_idx on public.requests (bot, created_at desc);

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.requests      enable row level security;

-- Owner inbox: when the owner last opened each conversation, and one row per conversation
-- with its latest message, latest client message and latest saved request.
alter table public.conversations add column if not exists admin_seen_at timestamptz;

create or replace view public.admin_inbox with (security_invoker = true) as
select
  c.id,
  c.bot,
  c.created_at,
  c.updated_at,
  c.admin_seen_at,
  last_msg.text        as last_text,
  last_msg.role        as last_role,
  last_msg.created_at  as last_at,
  last_client.text     as last_client_text,
  last_client.created_at as last_client_at,
  req.kind             as request_kind,
  req.status           as request_status,
  req.data             as request_data
from public.conversations c
left join lateral (
  select m.text, m.role, m.created_at from public.messages m
  where m.conversation_id = c.id order by m.id desc limit 1
) last_msg on true
left join lateral (
  select m.text, m.created_at from public.messages m
  where m.conversation_id = c.id and m.role = 'client' order by m.id desc limit 1
) last_client on true
left join lateral (
  select r.kind, r.status, r.data from public.requests r
  where r.conversation_id = c.id order by r.created_at desc limit 1
) req on true;

-- Only the server (service role) reads it.
revoke all on public.admin_inbox from anon, authenticated;

-- Orders from a catalogue (e.g. the pastry shop demo).
alter table public.requests drop constraint if exists requests_kind_check;
alter table public.requests add constraint requests_kind_check check (kind in ('details', 'booking', 'order'));

-- ---------------------------------------------------------------------------
-- What people do on the site: one row per page opened, no personal data.
-- The id comes from the page, so the same view can be updated when it closes.
create table if not exists public.page_views (
  id uuid primary key,
  visitor text not null,
  session text not null,
  page text not null,
  bot text,
  source text,
  device text,
  seconds integer not null default 0,
  events text[] not null default '{}',
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists page_views_created_idx on public.page_views (created_at desc);
create index if not exists page_views_session_idx on public.page_views (session);
alter table public.page_views enable row level security;
revoke all on public.page_views from anon, authenticated;
