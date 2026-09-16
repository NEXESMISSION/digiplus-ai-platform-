-- Free plan removed, Business plan added (run once on a database created before this change).
-- Old 'free' accounts become trials: they keep working for 7 more days, then their bots
-- stop answering until a plan is paid.

alter table public.accounts drop constraint if exists accounts_plan_check;

update public.accounts
   set plan = 'trial',
       plan_expires_at = coalesce(plan_expires_at, now() + interval '7 days')
 where plan = 'free';

alter table public.accounts
  add constraint accounts_plan_check check (plan in ('trial', 'starter', 'pro', 'business'));

alter table public.accounts alter column plan set default 'trial';

-- Paid plans must always carry an end date now; a trial without one counts as finished.
update public.accounts
   set plan_expires_at = now() + interval '7 days'
 where plan = 'trial' and plan_expires_at is null;

alter table public.payment_requests drop constraint if exists payment_requests_plan_check;

alter table public.payment_requests
  add constraint payment_requests_plan_check check (plan is null or plan in ('starter', 'pro', 'business'));

-- ---------------------------------------------------------------- sign-up details
-- Sign-up now asks for a phone number and where the business is.
alter table public.accounts add column if not exists phone   text;
alter table public.accounts add column if not exists country text;
alter table public.accounts add column if not exists city    text;

-- The super admin list shows them. The returned columns changed, so the function
-- is dropped and recreated (create or replace cannot change a return type).
drop function if exists public.super_accounts(text);

create function public.super_accounts(p_period text)
returns table (
  id uuid, name text, owner_email text, claim_email text, phone text, country text, city text,
  plan text, plan_expires_at timestamptz,
  billing_provider text, extra_bots int, created_at timestamptz,
  bots bigint, conversations bigint,
  replies int, bonus_replies int, summaries int, cost_usd numeric, limit_hit_at timestamptz
)
language sql stable set search_path = public as $$
  select a.id, a.name, a.owner_email, a.claim_email, a.phone, a.country, a.city,
         a.plan, a.plan_expires_at,
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

revoke execute on function public.super_accounts(text) from public, anon, authenticated;
grant execute on function public.super_accounts(text) to service_role;
