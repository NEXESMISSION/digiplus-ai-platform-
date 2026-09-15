-- ============================================================================
-- One-time migration from the single-bot version.
-- Moves the old bot settings and its conversations into an account that the owner
-- email below takes over when it signs up. Run AFTER schema.sql. Safe to re-run.
-- ============================================================================
do $$
declare
  v_owner_email text := 'saifelleuchi127@gmail.com';
  v_account uuid;
  v_bot uuid;
  v_data jsonb;
begin
  if to_regclass('public.bot_settings') is null then
    raise notice 'No single-bot data found, nothing to migrate.';
    return;
  end if;
  if exists (select 1 from public.bots) then
    raise notice 'Bots already exist, migration skipped.';
    return;
  end if;

  select data into v_data from public.bot_settings where id = 1;

  insert into public.accounts (name, claim_email, plan)
  values (coalesce(nullif(v_data ->> 'businessName', ''), 'My business'), lower(v_owner_email), 'pro')
  returning id into v_account;

  insert into public.bots (account_id, public_id, name, settings)
  values (
    v_account,
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
    coalesce(nullif(v_data ->> 'businessName', ''), 'My bot'),
    coalesce(v_data, '{}'::jsonb)
  )
  returning id into v_bot;

  update public.conversations set bot_id = v_bot where bot_id is null;
  alter table public.conversations alter column bot_id set not null;

  raise notice 'Migrated into account % and bot %', v_account, v_bot;
end $$;
