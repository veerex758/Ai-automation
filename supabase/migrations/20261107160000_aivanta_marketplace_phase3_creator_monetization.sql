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

alter table public.marketplace_entitlements add column if not exists subscription_id uuid references public.marketplace_subscriptions(id) on delete restrict;
create unique index if not exists marketplace_entitlement_subscription_idx on public.marketplace_entitlements(subscription_id) where subscription_id is not null;

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


-- Apply a verified provider subscription event exactly once and synchronize its
-- subscription entitlement atomically. Provider signature verification is external.
create or replace function public.marketplace_apply_subscription_event(
 p_provider text,p_event_id text,p_payload_sha256 text,p_event_type text,
 p_buyer_user_id uuid,p_product_id uuid,p_product_version_id uuid,
 p_provider_subscription_id text,p_period_start timestamptz,p_period_end timestamptz,
 p_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $
declare sub public.marketplace_subscriptions%rowtype; event_status text; entitlement_status text;
begin
 if auth.role()<>'service_role' then raise exception 'subscription_service_role_required'; end if;
 if p_provider is null or p_event_id is null or p_payload_sha256 !~ '^[a-f0-9]{64} from immutable ledger rows and only expose
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
 or p_provider_subscription_id is null then raise exception 'invalid_subscription_event'; end if;
 if exists(select 1 from public.marketplace_subscription_events where provider=p_provider and provider_event_id=p_event_id) then return jsonb_build_object('status','duplicate_event'); end if;
 if p_event_type in ('subscription.active','subscription.renewed','invoice.paid') then event_status:='active'; entitlement_status:='active';
 elsif p_event_type in ('subscription.past_due','invoice.payment_failed') then event_status:='past_due'; entitlement_status:='active';
 elsif p_event_type in ('subscription.cancelled','subscription.canceled') then event_status:='cancelled'; entitlement_status:='expired';
 elsif p_event_type in ('subscription.expired','subscription.ended') then event_status:='expired'; entitlement_status:='expired';
 else
  insert into public.marketplace_subscription_events(provider,provider_event_id,event_type,payload_sha256,occurred_at,outcome)
  values(p_provider,p_event_id,p_event_type,p_payload_sha256,p_occurred_at,'ignored');
  return jsonb_build_object('status','ignored');
 end if;
 if p_period_start is null or p_period_end is null or p_period_end<=p_period_start then raise exception 'invalid_subscription_period'; end if;
 if not exists(select 1 from public.marketplace_products p join public.marketplace_product_versions v on v.id=p.current_version_id and v.product_id=p.id and v.verification_status='approved' where p.id=p_product_id and p.status='published' and p.pricing_type='recurring' and p.current_version_id=p_product_version_id) then raise exception 'subscription_product_unavailable'; end if;
 insert into public.marketplace_subscriptions(buyer_user_id,product_id,product_version_id,provider,provider_subscription_id,status,current_period_start,current_period_end,last_provider_event_id,updated_at)
 values(p_buyer_user_id,p_product_id,p_product_version_id,p_provider,p_provider_subscription_id,event_status,p_period_start,p_period_end,p_event_id,now())
 on conflict(provider,provider_subscription_id) do update set status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,last_provider_event_id=excluded.last_provider_event_id,updated_at=now()
 returning * into sub;
 insert into public.marketplace_subscription_events(provider,provider_event_id,subscription_id,event_type,payload_sha256,occurred_at,processed_at,outcome)
 values(p_provider,p_event_id,sub.id,p_event_type,p_payload_sha256,p_occurred_at,now(),'processed');
 insert into public.marketplace_entitlements(user_id,product_id,subscription_id,entitlement_type,status,starts_at,ends_at)
 values(sub.buyer_user_id,sub.product_id,sub.id,'subscription',entitlement_status,sub.current_period_start,sub.current_period_end)
 on conflict(subscription_id) where subscription_id is not null do update set status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at;
 return jsonb_build_object('status',event_status,'subscription_id',sub.id,'entitlement_status',entitlement_status);
end; $;
revoke all on function public.marketplace_apply_subscription_event(text,text,text,text,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_apply_subscription_event(text,text,text,text,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz) to service_role;

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
