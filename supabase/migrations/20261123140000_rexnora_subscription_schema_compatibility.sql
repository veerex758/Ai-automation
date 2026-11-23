-- Reconcile the legacy Paystack subscription table with the shared plan entitlement model.
-- Preserve legacy columns and data; the new entitlement fields are additive.
alter table public.workspace_subscriptions
  add column if not exists plan_key text,
  add column if not exists billing_provider text,
  add column if not exists provider_customer_id text,
  add column if not exists provider_subscription_id text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists pending_plan_key text,
  add column if not exists pending_plan_effective_at timestamptz,
  add column if not exists grace_until timestamptz;

-- Backfill before applying NOT NULL/default constraints. Legacy plan slugs are retained.
update public.workspace_subscriptions
set plan_key = case
  when plan_slug like 'starter-%' then 'starter'
  when plan_slug like 'pro-%' then 'pro'
  when plan_slug like 'business-%' then 'business'
  when plan_slug = 'enterprise' then 'enterprise'
  else coalesce(plan_key, 'free')
end
where plan_key is null;

update public.workspace_subscriptions
set billing_provider = coalesce(billing_provider, provider)
where billing_provider is null;

alter table public.workspace_subscriptions
  alter column plan_key set default 'free',
  alter column plan_key set not null,
  alter column status set default 'active';

alter table public.workspace_subscriptions
  drop constraint if exists workspace_subscriptions_plan_key_check,
  add constraint workspace_subscriptions_plan_key_check
    check (plan_key in ('free','starter','pro','business','enterprise'));

alter table public.workspace_subscriptions
  drop constraint if exists workspace_subscriptions_status_check,
  add constraint workspace_subscriptions_status_check
    check (status in ('active','trialing','past_due','canceled','cancelled','expired','incomplete'));

alter table public.workspace_subscriptions
  drop constraint if exists workspace_subscriptions_billing_provider_check,
  add constraint workspace_subscriptions_billing_provider_check
    check (billing_provider is null or billing_provider in ('stripe','paystack','flutterwave'));

-- Older Paystack-only columns remain available to legacy code, but must not block
-- new Stripe/shared-entitlement rows from being created.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspace_subscriptions' and column_name='provider') then
    alter table public.workspace_subscriptions alter column provider drop not null;
    alter table public.workspace_subscriptions alter column provider drop default;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspace_subscriptions' and column_name='plan_slug') then
    alter table public.workspace_subscriptions alter column plan_slug set default 'free';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspace_subscriptions' and column_name='currency') then
    alter table public.workspace_subscriptions alter column currency set default 'USD';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='workspace_subscriptions' and column_name='amount_minor') then
    alter table public.workspace_subscriptions alter column amount_minor drop not null;
  end if;
end;
$$;

create index if not exists workspace_subscriptions_plan_status_idx
  on public.workspace_subscriptions(plan_key,status);
