-- Marketplace Phase 3: creator monetization expansion.
-- Durable subscription lifecycle + creator payout request/statement foundation.
-- Stacked on Phase 2; no live provider charges or transfers are enabled.

create table if not exists public.marketplace_subscriptions (
 id uuid primary key default gen_random_uuid(),
 buyer_user_id uuid not null references auth.users(id) on delete restrict,
 product_id uuid not null references public.marketplace_products(id) on delete restrict,
 product_version_id uuid not null references public.marketplace_product_versions(id) on delete restrict,
 provider text not null,
 provider_subscription_id text,
 provider_customer_id text,
 status text not null default 'pending' check(status in ('pending','active','past_due','cancelled','expired')),
 current_period_start timestamptz,
 current_period_end timestamptz,
 cancel_at_period_end boolean not null default false,
 cancelled_at timestamptz,
 grace_until timestamptz,
 last_provider_event_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(provider,provider_subscription_id)
);
create index if not exists marketplace_subscriptions_buyer_idx on public.marketplace_subscriptions(buyer_user_id,status,current_period_end);
create index if not exists marketplace_subscriptions_product_idx on public.marketplace_subscriptions(product_id,status);

create table if not exists public.marketplace_subscription_events (
 id uuid primary key default gen_random_uuid(),
 provider text not null,
 provider_event_id text not null,
 subscription_id uuid references public.marketplace_subscriptions(id) on delete restrict,
 event_type text not null,
 payload_sha256 char(64) not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 occurred_at timestamptz,
 processed_at timestamptz,
 outcome text not null default 'received' check(outcome in ('received','processed','ignored','failed')),
 error_code text,
 created_at timestamptz not null default now(),
 unique(provider,provider_event_id)
);
create index if not exists marketplace_subscription_events_status_idx on public.marketplace_subscription_events(outcome,created_at);

create table if not exists public.marketplace_payout_requests (
 id uuid primary key default gen_random_uuid(),
 creator_id uuid not null references public.marketplace_creators(id) on delete restrict,
 amount_minor bigint not null check(amount_minor>0),
 currency char(3) not null default 'USD' check(currency='USD'),
 status text not null default 'requested' check(status in ('requested','under_review','approved','processing','paid','rejected','failed','cancelled','on_hold')),
 payout_provider text,
 provider_transfer_id text unique,
 requested_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id) on delete set null,
 processed_at timestamptz,
 failure_code text,
 notes text not null default '',
 idempotency_key text not null,
 unique(creator_id,idempotency_key)
);
create index if not exists marketplace_payout_creator_idx on public.marketplace_payout_requests(creator_id,requested_at desc);
create index if not exists marketplace_payout_status_idx on public.marketplace_payout_requests(status,requested_at);

create table if not exists public.marketplace_creator_statements (
 id uuid primary key default gen_random_uuid(),
 creator_id uuid not null references public.marketplace_creators(id) on delete restrict,
 period_start date not null,
 period_end date not null check(period_end>=period_start),
 currency char(3) not null default 'USD' check(currency='USD'),
 gross_sales_minor bigint not null default 0,
 commission_minor bigint not null default 0,
 creator_earnings_minor bigint not null default 0,
 reversals_minor bigint not null default 0,
 fees_tax_minor bigint not null default 0,
 payouts_minor bigint not null default 0,
 net_payable_minor bigint not null default 0,
 ledger_cutoff timestamptz not null,
 generated_at timestamptz not null default now(),
 generated_by uuid references auth.users(id) on delete set null,
 unique(creator_id,period_start,period_end)
);

alter table public.marketplace_subscriptions enable row level security;
alter table public.marketplace_subscription_events enable row level security;
alter table public.marketplace_payout_requests enable row level security;
alter table public.marketplace_creator_statements enable row level security;
revoke all on public.marketplace_subscriptions,public.marketplace_subscription_events,public.marketplace_payout_requests,public.marketplace_creator_statements from anon,authenticated;
grant all on public.marketplace_subscriptions,public.marketplace_subscription_events,public.marketplace_payout_requests,public.marketplace_creator_statements to service_role;

-- Creator-facing earnings are derived from immutable ledger rows and only expose
-- the caller's own creator account. No client access to raw financial ledger.
create or replace function public.marketplace_creator_earnings_summary()
returns table(currency char(3),gross_sales_minor bigint,commission_minor bigint,
 creator_earnings_minor bigint,reversals_minor bigint,fees_tax_minor bigint,
 payouts_minor bigint,available_minor bigint)
language sql stable security definer set search_path=public,pg_temp as $$
 select 'USD'::char(3),
  coalesce(sum(case when l.entry_type='gross_sale' then l.amount_minor else 0 end),0)::bigint,
  coalesce(sum(case when l.entry_type='platform_commission' then l.amount_minor else 0 end),0)::bigint,
  coalesce(sum(case when l.entry_type='creator_earning' then l.amount_minor else 0 end),0)::bigint,
  coalesce(sum(case when l.entry_type='creator_earning_reversal' then -l.amount_minor when l.entry_type='creator_earning' and l.amount_minor<0 then -l.amount_minor else 0 end),0)::bigint,
  coalesce(sum(case when l.entry_type in ('processor_fee','payment_fee','tax') then -l.amount_minor else 0 end),0)::bigint,
  coalesce(sum(case when l.entry_type='payout' then -l.amount_minor else 0 end),0)::bigint,
  coalesce(sum(case when l.entry_type in ('creator_earning','creator_earning_reversal','processor_fee','payment_fee','tax','payout') then l.amount_minor else 0 end),0)::bigint
 from public.marketplace_financial_ledger l
 join public.marketplace_creators c on c.id=l.creator_id
 where c.user_id=auth.uid() and c.status='verified';
$$;
revoke all on function public.marketplace_creator_earnings_summary() from public,anon;
grant execute on function public.marketplace_creator_earnings_summary() to authenticated;

-- A creator can request a payout only against an available, verified creator
-- balance; the request is a hold, not a transfer. Finance must approve separately.
create or replace function public.marketplace_request_payout(p_amount_minor bigint,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare creator public.marketplace_creators%rowtype; available bigint; payout_id uuid;
begin
 if p_amount_minor<=0 or p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 128 then
  raise exception 'invalid_payout_request';
 end if;
 select * into creator from public.marketplace_creators where user_id=auth.uid() for update;
 if not found or creator.status<>'verified' then raise exception 'creator_not_eligible'; end if;
 if creator.payout_provider is null or creator.payout_account_ref is null then raise exception 'payout_onboarding_incomplete'; end if;
 select coalesce(sum(case when entry_type in ('creator_earning','creator_earning_reversal','processor_fee','payment_fee','tax','payout') then amount_minor else 0 end),0)
 into available from public.marketplace_financial_ledger where creator_id=creator.id;
 select available-coalesce(sum(amount_minor),0) into available from public.marketplace_payout_requests
 where creator_id=creator.id and status in ('requested','under_review','approved','processing');
 if p_amount_minor>available then raise exception 'insufficient_available_balance'; end if;
 insert into public.marketplace_payout_requests(creator_id,amount_minor,payout_provider,idempotency_key)
 values(creator.id,p_amount_minor,creator.payout_provider,p_idempotency_key)
 on conflict(creator_id,idempotency_key) do nothing returning id into payout_id;
 if payout_id is null then select id into payout_id from public.marketplace_payout_requests where creator_id=creator.id and idempotency_key=p_idempotency_key; end if;
 return payout_id;
end; $$;
revoke all on function public.marketplace_request_payout(bigint,text) from public,anon;
grant execute on function public.marketplace_request_payout(bigint,text) to authenticated;

-- Finance status changes are service-only and append a traceable audit entry.
create or replace function public.marketplace_review_payout_request(p_request_id uuid,p_action text,p_reason text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare payout public.marketplace_payout_requests%rowtype; next_status text;
begin
 if auth.role()<>'service_role' then raise exception 'finance_service_role_required'; end if;
 select * into payout from public.marketplace_payout_requests where id=p_request_id for update;
 if not found then raise exception 'payout_request_not_found'; end if;
 next_status:=case p_action when 'hold' then 'on_hold' when 'approve' then 'approved' when 'reject' then 'rejected' when 'processing' then 'processing' when 'failed' then 'failed' when 'paid' then 'paid' else null end;
 if next_status is null then raise exception 'invalid_payout_action'; end if;
 if payout.status not in ('requested','under_review','approved','processing','on_hold') then raise exception 'payout_request_terminal'; end if;
 if next_status='paid' and (payout.provider_transfer_id is null or payout.payout_provider is null) then raise exception 'transfer_reference_required'; end if;
 update public.marketplace_payout_requests set status=next_status,reviewed_at=case when next_status in ('approved','rejected','on_hold') then now() else reviewed_at end,
 reviewed_by=auth.uid(),processed_at=case when next_status='paid' then now() else processed_at end,notes=concat_ws(E'\n',nullif(notes,''),nullif(p_reason,'')) where id=payout.id;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(auth.uid(),'payout.'||next_status,'payout_request',payout.id,jsonb_build_object('amount_minor',payout.amount_minor,'reason',p_reason));
 return jsonb_build_object('id',payout.id,'status',next_status);
end; $$;
revoke all on function public.marketplace_review_payout_request(uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_review_payout_request(uuid,text,text) to service_role;
