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

create index if not exists workspace_ai_credit_transactions_history_idx
  on public.workspace_ai_credit_transactions(workspace_id, created_at desc);

alter table public.workspace_ai_credit_wallets enable row level security;
alter table public.workspace_ai_credit_transactions enable row level security;

drop policy if exists workspace_ai_credit_wallets_member_read on public.workspace_ai_credit_wallets;
create policy workspace_ai_credit_wallets_member_read
  on public.workspace_ai_credit_wallets for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists workspace_ai_credit_transactions_member_read on public.workspace_ai_credit_transactions;
create policy workspace_ai_credit_transactions_member_read
  on public.workspace_ai_credit_transactions for select to authenticated
  using (private.is_workspace_member(workspace_id));

revoke all on public.workspace_ai_credit_wallets from anon, authenticated, service_role;
revoke all on public.workspace_ai_credit_transactions from anon, authenticated, service_role;
grant select on public.workspace_ai_credit_wallets to authenticated;
grant select on public.workspace_ai_credit_transactions to authenticated;


create or replace function public.grant_workspace_ai_credit_topup(
  p_workspace_id uuid,
  p_credits integer,
  p_provider text,
  p_provider_payment_id text,
  p_currency text,
  p_amount_minor bigint,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_key text;
  v_transaction public.workspace_ai_credit_transactions%rowtype;
  v_balance bigint;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  -- This RPC is intentionally service-role-only. Its caller must verify the
  -- payment provider's webhook signature and successful-payment event first.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;

  if p_workspace_id is null
     or p_credits is null or p_credits < 1 or p_credits > 10000000
     or p_provider is null or p_provider not in ('paddle','stripe','paystack','flutterwave')
     or p_provider_payment_id is null or length(btrim(p_provider_payment_id)) not between 1 and 255
     or p_currency is null or p_currency !~ '^[A-Z]{3}$'
     or p_amount_minor is null or p_amount_minor < 1
     or jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'invalid AI credit top-up' using errcode='22023';
  end if;

  v_key := p_provider || ':' || p_provider_payment_id;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 1));

  insert into public.workspace_ai_credit_wallets(workspace_id)
    values (p_workspace_id)
    on conflict (workspace_id) do nothing;

  select balance into v_balance
    from public.workspace_ai_credit_wallets
    where workspace_id = p_workspace_id
    for update;

  insert into public.workspace_ai_credit_transactions(
    workspace_id, entry_type, credits_delta, provider, provider_payment_id,
    currency, amount_minor, idempotency_key, metadata
  ) values (
    p_workspace_id, 'purchase', p_credits, p_provider, p_provider_payment_id,
    p_currency, p_amount_minor, v_key, v_metadata
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into v_transaction;

  if v_transaction.id is null then
    select * into v_transaction
      from public.workspace_ai_credit_transactions
      where workspace_id = p_workspace_id and idempotency_key = v_key;

    if v_transaction.credits_delta <> p_credits
       or v_transaction.currency <> p_currency
       or v_transaction.amount_minor <> p_amount_minor then
      raise exception 'payment reference was already recorded with different top-up details'
        using errcode='22023';
    end if;

    return jsonb_build_object(
      'granted', true, 'duplicate', true,
      'transaction_id', v_transaction.id, 'balance', v_balance
    );
  end if;

  update public.workspace_ai_credit_wallets
    set balance = balance + p_credits, updated_at = now()
    where workspace_id = p_workspace_id
    returning balance into v_balance;

  return jsonb_build_object(
    'granted', true, 'duplicate', false,
    'transaction_id', v_transaction.id, 'credits_added', p_credits,
    'balance', v_balance, 'currency', p_currency, 'amount_minor', p_amount_minor
  );
end
$$;

revoke all on function public.grant_workspace_ai_credit_topup(uuid,integer,text,text,text,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function public.grant_workspace_ai_credit_topup(uuid,integer,text,text,text,bigint,jsonb)
  to service_role;
