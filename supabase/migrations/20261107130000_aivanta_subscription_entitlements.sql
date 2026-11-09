-- Phase 5: persisted workspace subscription entitlements and atomic usage metering.
create table if not exists public.workspace_subscriptions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
 plan_key text not null default 'free' check (plan_key in ('free','starter','pro','business')),
 status text not null default 'active' check (status in ('active','trialing','past_due','canceled','incomplete')),
 billing_provider text check (billing_provider in ('stripe','paystack','flutterwave')),
 provider_customer_id text,
 provider_subscription_id text,
 current_period_start timestamptz not null default date_trunc('month',now()),
 current_period_end timestamptz not null default (date_trunc('month',now()) + interval '1 month'),
 cancel_at_period_end boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists workspace_subscriptions_plan_status_idx on public.workspace_subscriptions(plan_key,status);
alter table public.workspace_subscriptions enable row level security;
drop policy if exists workspace_subscriptions_member_read on public.workspace_subscriptions;
create policy workspace_subscriptions_member_read on public.workspace_subscriptions for select to authenticated using (private.is_workspace_member(workspace_id));
grant select on public.workspace_subscriptions to authenticated;
revoke all on public.w¶»§q«^