-- Global-ready, provider-neutral AI credit top-up ledger.
-- A trusted webhook handler may call the grant RPC only after verifying the
-- provider signature and confirming a successful, settled payment. No checkout
-- or provider integration is enabled by this migration.

create table if not exists public.workspace_ai_credit_wallets (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_ai_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entry_type text not null check (entry_type in ('purchase')),
  credits_delta bigint not null check (credits_delta > 0),
  provider text not null check (provider in ('paddle','stripe','paystack','flutterwave')),
  provider_payment_id text not null check (length(provider_payment_id) between 1 and 255),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint workspace_ai_credit_transactions_idempotency_unique unique (workspace_id, idempotency_key)
);

create index if not ex¶»§q«^