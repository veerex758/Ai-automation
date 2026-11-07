-- Marketplace Phase 2 financial ledger foundation. Reversible by a reviewed forward migration; staging replay required.
-- Provider webhook inbox is durable and unique per provider event.
create table if not exists public.marketplace_payment_events (
 id uuid primary key default gen_random_uuid(),
 provider text not null check (provider ~ '^[a-z0-9_-]{2,40}$'),
 provider_event_id text not null check (char_length(provider_event_id) between 1 and 255),
 event_type text not null check (char_length(event_type) between 1 and 160),
 payload_sha256 char(64) not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default now(),
 occurred_at timestamptz,
 processing_status text not null default 'received' check (processing_status in ('received','processing','processed','ignored','failed')),
 processed_at timestamptz,
 error_code text,
 unique(provider,provider_event_id)
);
-- Ledger entries are append-only, integer minor units, and explicitly balanced by currency.
create table if not exists public.marketplace_financial_ledger (
 id uuid primary key default gen_random_uuid(),
 purchase_id uuid references public.marketplace_purchases(id) on delete restrict,
 creator_id uuid references public.marketplace_creators(id) on delete restrict,
 provider text,
 provider_event_id text,
 entry_type text not null check (entry_type in ('gross_sale','platform_commission','creator_earning','processor_fee','tax','refund','chargeback','payout','adjustment')),
 amount_minor bigint not null check (amount_minor<>0),
 currency char(3) not null default 'USD' check(currency='USD'),
 memo text not null default '',
 created_at timestamptz not null default now(),
 created_by uuid references auth.users(id) on delete set null,
 unique(provider,provider_event_id,entry_type,purchase_id)
);
create index if not exists marketplace_ledger_purchase_idx on public.marketplace_financial_ledger(purchase_id,created_at);
create index if not exists marketplace_ledger_creator_idx on public.marketplace_financial_ledger(creator_id,created_at);
create index if not exists marketplace_events_status_idx on public.marketplace_payment_events(processing_status,received_at);
alter table public.marketplace_payment_events enable row level security;
alter table public.marketplace_financial_ledger enable row level security;
-- Service role only: no client read/write policies or grants.
revoke all on public.marketplace_payment_events from anon,authenticated;
revoke all on public.marketplace_financial_ledger from anon,authenticated;
grant all on public.marketplace_payment_events,public.marketplace_financial_ledger to service_role;

-- Ledger immutability: append-only records. Service role is the only writer, and
-- even it cannot UPDATE or DELETE entries through ordinary SQL privileges.
revoke update,delete on public.marketplace_financial_ledger from service_role;
