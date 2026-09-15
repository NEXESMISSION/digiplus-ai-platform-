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
