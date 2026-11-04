-- Paystack billing foundation. Additive and reversible; apply to staging only after review.
create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null default 'paystack' check (provider = 'paystack'),
  reference text not null unique,
  plan_slug text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','success','failed','abandoned','refunded')),
  authorization_url text,
  access_code text,
  provider_transaction_id bigint,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, reference)
);
create index if not exists billing_payments_workspace_created_idx on public.billing_payments(workspace_id, created_at desc);

create table if not exists public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  provider text not null default 'paystack' check (provider = 'paystack'),
  plan_slug text not null,
  status text not null check (status in ('active','past_due','cancelled','expired')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  last_payment_id uuid references public.billing_payments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paystack' check (provider = 'paystack'),
  event_key text not null unique,
  event_type text not null,
  reference text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.billing_payments enable row level security;
alter table public.workspace_subscriptions enable row level security;
alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_payments, public.workspace_subscriptions, public.billing_webhook_events from public, anon, authenticated;
grant select on public.billing_payments, public.workspace_subscriptions to authenticated;
grant all on public.billing_payments, public.workspace_subscriptions, public.billing_webhook_events to service_role;

drop policy if exists "workspace members read billing payments" on public.billing_payments;
create policy "workspace members read billing payments" on public.billing_payments for select to authenticated
using (exists (select 1 from public.workspace_members wm where wm.workspace_id = billing_payments.workspace_id and wm.user_id = auth.uid()));
drop policy if exists "workspace members read subscription" on public.workspace_subscriptions;
create policy "workspace members read subscription" on public.workspace_subscriptions for select to authenticated
using (exists (select 1 from public.workspace_members wm where wm.workspace_id = workspace_subscriptions.workspace_id and wm.user_id = auth.uid()));

comment on table public.billing_payments is 'Server-created Paystack payment attempts; client writes are intentionally denied.';
comment on table public.workspace_subscriptions is 'Server-maintained workspace entitlements derived only from verified payments.';
comment on table public.billing_webhook_events is 'Server-only idempotency ledger for authenticated Paystack webhook events.';
