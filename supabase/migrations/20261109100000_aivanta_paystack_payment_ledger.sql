-- Paystack payment attempt and webhook ledger. workspace_subscriptions is owned by Phase 5.
create table if not exists public.billing_payments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete restrict,provider text not null default 'paystack' check(provider='paystack'),
 reference text not null unique,plan_slug text not null,amount_minor bigint not null check(amount_minor>0),
 currency text not null check(currency ~ '^[A-Z]{3}$'),status text not null default 'pending' check(status in('pending','success','failed','abandoned','refunded')),
 authorization_url text,access_code text,provider_transaction_id bigint,paid_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,reference));
create index if not exists billing_payments_workspace_created_idx on public.billing_payments(workspace_id,created_at desc);
create table if not exists public.billing_webhook_events(
 id uuid primary key default gen_random_uuid(),provider text not null default 'paystack' check(provider='paystack'),
 event_key text not null unique,event_type text not null,reference text,received_at timestamptz not null default now(),processed_at timestamptz);
alter table public.billing_payments enable row level security;alter table public.billing_webhook_events enable row level security;
revoke all on public.bi¶»§q«^