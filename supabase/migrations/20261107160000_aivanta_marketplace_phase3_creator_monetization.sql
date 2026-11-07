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



-- Verified provider events are deduplicated and ordered by occurred_at. The
-- seven-day payment-failure grace is explicit and expires automatically.
create or replace function public.marketplace_apply_subscription_event(
 p_provider text,p_event_id text,p_payload_sha256 text,p_event_type text,
 p_buyer_user_id uuid,p_product_id uuid,p_product_version_id uuid,
 p_provider_subscription_id text,p_period_start timestamptz,p_period_end timestamptz,
 p_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 sub public.marketplace_subscriptions%rowtype;
 prior_event public.marketplace_subscription_events%rowtype;
 event_status text; entitlement_status text; entitlement_end timestamptz;
 grace_deadline timestamptz; event_time timestamptz:=coalesce(p_occurred_at,now());
begin
 if auth.role()<>'service_role' then raise exception 'subscription_service_role_required'; end if;
 if nullif(trim(p_provider),'') is null or nullif(trim(p_event_id),'') is null
  or nullif(trim(p_provider_subscription_id),'') is null
  or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
  raise exception 'invalid_subscription_event';
 end if;
 -- Serialize duplicate webhook delivery and ordering for this provider subscription.
 perform pg_advisory_xact_lock(hashtextextended('marketplace-sub-event:'||p_provider||':'||p_event_id,0));
 perform pg_advisory_xact_lock(hashtextextended('marketplace-subscription:'||p_provider||':'||p_provider_subscription_id,0));
 select * into prior_event from public.marketplace_subscription_events
 where provider=p_provider and provider_event_id=p_event_id;
 if found then
  if prior_event.payload_sha256<>p_payload_sha256 then raise exception 'subscription_event_payload_conflict'; end if;
  return jsonb_build_object('status','duplicate_event');
 end if;
 if p_event_type in ('subscription.active','subscription.renewed','invoice.paid') then
  event_status:='active'; entitlement_status:='active'; grace_deadline:=null;
 elsif p_event_type in ('subscription.past_due','invoice.payment_failed') then
  event_status:='past_due'; grace_deadline:=event_time+interval '7 days';
  entitlement_status:=case when grace_deadline>now() then 'active' else 'expired' end;
 elsif p_event_type in ('subscription.cancelled','subscription.canceled') then
  event_status:='cancelled'; entitlement_status:='expired'; grace_deadline:=null;
 elsif p_event_type in ('subscription.expired','subscription.ended') then
  event_status:='expired'; entitlement_status:='expired'; grace_deadline:=null;
 else
  insert into public.marketplace_subscription_events(provider,provider_event_id,event_type,payload_sha256,occurred_at,outcome)
  values(p_provider,p_event_id,p_event_type,p_payload_sha256,event_time,'ignored');
  return jsonb_build_object('status','ignored');
 end if;
 if p_period_start is null or p_period_end is null or p_period_end<=p_period_start then
  raise exception 'invalid_subscription_period';
 end if;
 if not exists(
  select 1 from public.marketplace_products p
  join public.marketplace_product_versions v on v.id=p_product_version_id and v.product_id=p.id and v.verification_status='approved'
  where p.id=p_product_id and p.status='published' and p.pricing_type='recurring'
 ) then raise exception 'subscription_product_unavailable'; end if;

 select * into sub from public.marketplace_subscriptions
 where provider=p_provider and provider_subscription_id=p_provider_subscription_id for update;
 if found and sub.last_provider_event_id is not null then
  select * into prior_event from public.marketplace_subscription_events
   where provider=p_provider and provider_event_id=sub.last_provider_event_id;
  if found and prior_event.occurred_at is not null and event_time<prior_event.occurred_at then
   insert into public.marketplace_subscription_events(provider,provider_event_id,subscription_id,event_type,payload_sha256,occurred_at,processed_at,outcome,error_code)
   values(p_provider,p_event_id,sub.id,p_event_type,p_payload_sha256,event_time,now(),'ignored','stale_provider_event');
   return jsonb_build_object('status','stale_event','subscription_id',sub.id);
  end if;
  if sub.buyer_user_id<>p_buyer_user_id or sub.product_id<>p_product_id or sub.product_version_id<>p_product_version_id then raise exception 'subscription_identity_mismatch'; end if;
 else
  if not exists(select 1 from public.marketplace_products where id=p_product_id and current_version_id=p_product_version_id) then
   raise exception 'subscription_product_version_not_current';
  end if;
 end if;
 insert into public.marketplace_subscriptions(buyer_user_id,product_id,product_version_id,provider,provider_subscription_id,status,current_period_start,current_period_end,grace_until,cancelled_at,last_provider_event_id,updated_at)
 values(p_buyer_user_id,p_product_id,p_product_version_id,p_provider,p_provider_subscription_id,event_status,p_period_start,p_period_end,grace_deadline,case when event_status='cancelled' then event_time else null end,p_event_id,now())
 on conflict(provider,provider_subscription_id) do update set
  product_version_id=excluded.product_version_id,status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
  grace_until=excluded.grace_until,cancelled_at=excluded.cancelled_at,
  last_provider_event_id=excluded.last_provider_event_id,updated_at=now()
 returning * into sub;
 entitlement_end:=case when event_status='past_due' then grace_deadline else sub.current_period_end end;
 insert into public.marketplace_subscription_events(provider,provider_event_id,subscription_id,event_type,payload_sha256,occurred_at,processed_at,outcome)
 values(p_provider,p_event_id,sub.id,p_event_type,p_payload_sha256,event_time,now(),'processed');
 insert into public.marketplace_entitlements(user_id,product_id,subscription_id,entitlement_type,status,starts_at,ends_at)
 values(sub.buyer_user_id,sub.product_id,sub.id,'subscription',entitlement_status,sub.current_period_start,entitlement_end)
 on conflict(subscription_id) where subscription_id is not null
 do update set status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at;
 return jsonb_build_object('status',event_status,'subscription_id',sub.id,'entitlement_status',entitlement_status,'grace_until',grace_deadline);
end; $$;
revoke all on function public.marketplace_apply_subscription_event(text,text,text,text,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_apply_subscription_event(text,text,text,text,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz) to service_role;

-- Ledger-derived creator balance. Negative creator_earning rows represent reversals.
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
 from public.marketplace_financial_ledger l join public.marketplace_creators c on c.id=l.creator_id
 where c.user_id=auth.uid() and c.status='verified';
$$;
revoke all on function public.marketplace_creator_earnings_summary() from public,anon;
grant execute on function public.marketplace_creator_earnings_summary() to authenticated;

-- Payout holds are serialized by locking the creator row. Idempotency reuse must
-- match the original amount; held requests continue reserving funds.
create or replace function public.marketplace_request_payout(p_amount_minor bigint,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare creator public.marketplace_creators%rowtype; available bigint; payout_id uuid; prior public.marketplace_payout_requests%rowtype;
begin
 if p_amount_minor<=0 or p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 128 then raise exception 'invalid_payout_request'; end if;
 select * into creator from public.marketplace_creators where user_id=auth.uid() for update;
 if not found or creator.status<>'verified' then raise exception 'creator_not_eligible'; end if;
 if creator.payout_provider is null or creator.payout_account_ref is null then raise exception 'payout_onboarding_incomplete'; end if;
 select * into prior from public.marketplace_payout_requests where creator_id=creator.id and idempotency_key=p_idempotency_key;
 if found then
  if prior.amount_minor<>p_amount_minor then raise exception 'payout_idempotency_conflict'; end if;
  return prior.id;
 end if;
 select coalesce(sum(case when entry_type in ('creator_earning','creator_earning_reversal','processor_fee','payment_fee','tax','payout') then amount_minor else 0 end),0)
 into available from public.marketplace_financial_ledger where creator_id=creator.id;
 select available-coalesce(sum(amount_minor),0) into available from public.marketplace_payout_requests
 where creator_id=creator.id and status in ('requested','under_review','approved','processing','on_hold');
 if p_amount_minor>available then raise exception 'insufficient_available_balance'; end if;
 insert into public.marketplace_payout_requests(creator_id,amount_minor,payout_provider,idempotency_key)
 values(creator.id,p_amount_minor,creator.payout_provider,p_idempotency_key) returning id into payout_id;
 return payout_id;
end; $$;
revoke all on function public.marketplace_request_payout(bigint,text) from public,anon;
grant execute on function public.marketplace_request_payout(bigint,text) to authenticated;

-- Each creator-period statement is a cutoff snapshot. Existing statements are
-- immutable and returned on retries; only service role can generate snapshots.
create or replace function public.marketplace_generate_creator_statement(
 p_creator_id uuid,p_period_start date,p_period_end date,p_cutoff timestamptz default now()
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare statement_id uuid; totals record;
begin
 if auth.role()<>'service_role' then raise exception 'statement_service_role_required'; end if;
 if p_creator_id is null or p_period_start is null or p_period_end<p_period_start or p_cutoff is null then raise exception 'invalid_statement_period'; end if;
 select
  coalesce(sum(case when entry_type='gross_sale' then amount_minor else 0 end),0)::bigint gross,
  coalesce(sum(case when entry_type='platform_commission' then amount_minor else 0 end),0)::bigint commission,
  coalesce(sum(case when entry_type='creator_earning' and amount_minor>0 then amount_minor else 0 end),0)::bigint earnings,
  coalesce(sum(case when entry_type='creator_earning' and amount_minor<0 then -amount_minor when entry_type='creator_earning_reversal' then -amount_minor else 0 end),0)::bigint reversals,
  coalesce(sum(case when entry_type in ('processor_fee','payment_fee','tax') then -amount_minor else 0 end),0)::bigint fees,
  coalesce(sum(case when entry_type='payout' then -amount_minor else 0 end),0)::bigint payouts,
  coalesce(sum(amount_minor) filter(where entry_type in ('creator_earning','creator_earning_reversal','processor_fee','payment_fee','tax','payout')),0)::bigint net
 into totals from public.marketplace_financial_ledger
 where creator_id=p_creator_id and created_at<=p_cutoff
  and created_at>=p_period_start::timestamptz and created_at<(p_period_end+1)::timestamptz;
 insert into public.marketplace_creator_statements(creator_id,period_start,period_end,gross_sales_minor,commission_minor,creator_earnings_minor,reversals_minor,fees_tax_minor,payouts_minor,net_payable_minor,ledger_cutoff,generated_by)
 values(p_creator_id,p_period_start,p_period_end,totals.gross,totals.commission,totals.earnings,totals.reversals,totals.fees,totals.payouts,totals.net,p_cutoff,auth.uid())
 on conflict(creator_id,period_start,period_end) do nothing returning id into statement_id;
 if statement_id is null then select id into statement_id from public.marketplace_creator_statements where creator_id=p_creator_id and period_start=p_period_start and period_end=p_period_end; end if;
 return statement_id;
end; $$;
revoke all on function public.marketplace_generate_creator_statement(uuid,date,date,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_generate_creator_statement(uuid,date,date,timestamptz) to service_role;

-- Paid status is only a reconciliation assertion after an external transfer.
-- The payout ledger entry is atomic with the status change and deduplicated by
-- payout request id; this function never calls a provider.
alter table public.marketplace_financial_ledger add column if not exists payout_request_id uuid references public.marketplace_payout_requests(id) on delete restrict;
create unique index if not exists marketplace_ledger_payout_request_unique on public.marketplace_financial_ledger(payout_request_id) where payout_request_id is not null;
create or replace function public.marketplace_review_payout_request(p_request_id uuid,p_action text,p_reason text default '',p_transfer_id text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare payout public.marketplace_payout_requests%rowtype; next_status text;
begin
 if auth.role()<>'service_role' then raise exception 'finance_service_role_required'; end if;
 select * into payout from public.marketplace_payout_requests where id=p_request_id for update;
 if not found then raise exception 'payout_request_not_found'; end if;
 next_status:=case p_action when 'hold' then 'on_hold' when 'approve' then 'approved' when 'reject' then 'rejected' when 'processing' then 'processing' when 'failed' then 'failed' when 'paid' then 'paid' else null end;
 if next_status is null then raise exception 'invalid_payout_action'; end if;
 if payout.status='paid' and next_status='paid' and coalesce(p_transfer_id,payout.provider_transfer_id)=payout.provider_transfer_id then return jsonb_build_object('id',payout.id,'status','paid','duplicate',true); end if;
 if not (
  (payout.status='requested' and next_status in ('under_review','approved','rejected','on_hold')) or
  (payout.status='under_review' and next_status in ('approved','rejected','on_hold')) or
  (payout.status='approved' and next_status in ('processing','failed','on_hold')) or
  (payout.status='processing' and next_status in ('paid','failed','on_hold')) or
  (payout.status='on_hold' and next_status in ('under_review','approved','rejected')) or
  (payout.status='failed' and next_status in ('processing','on_hold'))
 ) then raise exception 'payout_transition_invalid'; end if;
 if next_status='paid' and (coalesce(p_transfer_id,payout.provider_transfer_id) is null or payout.payout_provider is null) then raise exception 'transfer_reference_required'; end if;
 if next_status='paid' and payout.provider_transfer_id is not null and p_transfer_id is not null and payout.provider_transfer_id<>p_transfer_id then raise exception 'payout_transfer_reference_conflict'; end if;
 update public.marketplace_payout_requests set status=next_status,reviewed_at=case when next_status in ('approved','rejected','on_hold') then now() else reviewed_at end,
 reviewed_by=auth.uid(),processed_at=case when next_status='paid' then now() else processed_at end,
 provider_transfer_id=coalesce(p_transfer_id,provider_transfer_id),notes=concat_ws(E'\n',nullif(notes,''),nullif(p_reason,'')) where id=payout.id;
 if next_status='paid' then
  insert into public.marketplace_financial_ledger(creator_id,entry_type,amount_minor,currency,memo,payout_request_id)
  values(payout.creator_id,'payout',-payout.amount_minor,payout.currency,'Reconciled creator payout '||payout.provider_transfer_id,payout.id)
  on conflict(payout_request_id) where payout_request_id is not null do nothing;
 end if;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(auth.uid(),'payout.'||next_status,'payout_request',payout.id,jsonb_build_object('amount_minor',payout.amount_minor,'transfer_id',payout.provider_transfer_id,'reason',p_reason));
 return jsonb_build_object('id',payout.id,'status',next_status);
end; $$;
revoke all on function public.marketplace_review_payout_request(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_review_payout_request(uuid,text,text,text) to service_role;

-- Preserve financial/subscription event history and statement snapshots. Definer RPCs
-- remain the only mutation path for finance lifecycle records.
revoke update,delete on public.marketplace_subscription_events,public.marketplace_creator_statements,public.marketplace_payout_requests from service_role;


-- Provider-backed payout onboarding is represented explicitly. Sensitive identity
-- documents remain with the payout provider; Aivanta stores only opaque refs
-- and compliance state required to gate disbursement.
create table if not exists public.marketplace_creator_payout_profiles (
 creator_id uuid primary key references public.marketplace_creators(id) on delete restrict,
 provider text not null,
 provider_account_ref text not null,
 country_code char(2) not null check(country_code ~ '^[A-Z]{2}$'),
 onboarding_status text not null default 'pending' check(onboarding_status in ('pending','verified','restricted','disabled')),
 tax_status text not null default 'pending' check(tax_status in ('pending','complete','exempt')),
 payouts_enabled boolean not null default false,
 minimum_payout_minor bigint not null default 1000 check(minimum_payout_minor>0),
 hold_until timestamptz,
 verified_at timestamptz,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null
);
alter table public.marketplace_creator_payout_profiles enable row level security;
revoke all on public.marketplace_creator_payout_profiles from anon,authenticated;
grant select,insert,update on public.marketplace_creator_payout_profiles to service_role;

create or replace function public.marketplace_set_creator_payout_profile(
 p_creator_id uuid,p_provider text,p_account_ref text,p_country_code text,
 p_onboarding_status text,p_tax_status text,p_payouts_enabled boolean,
 p_minimum_payout_minor bigint,p_hold_until timestamptz
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()<>'service_role' then raise exception 'payout_profile_service_role_required'; end if;
 if p_creator_id is null or nullif(trim(p_provider),'') is null or nullif(trim(p_account_ref),'') is null
  or p_country_code !~ '^[A-Z]{2}$' or p_onboarding_status not in ('pending','verified','restricted','disabled')
  or p_tax_status not in ('pending','complete','exempt') or p_minimum_payout_minor<=0 then
  raise exception 'invalid_payout_profile';
 end if;
 insert into public.marketplace_creator_payout_profiles(creator_id,provider,provider_account_ref,country_code,onboarding_status,tax_status,payouts_enabled,minimum_payout_minor,hold_until,verified_at,updated_by,updated_at)
 values(p_creator_id,p_provider,p_account_ref,p_country_code,p_onboarding_status,p_tax_status,p_payouts_enabled,p_minimum_payout_minor,p_hold_until,case when p_onboarding_status='verified' then now() else null end,auth.uid(),now())
 on conflict(creator_id) do update set provider=excluded.provider,provider_account_ref=excluded.provider_account_ref,country_code=excluded.country_code,
 onboarding_status=excluded.onboarding_status,tax_status=excluded.tax_status,payouts_enabled=excluded.payouts_enabled,
 minimum_payout_minor=excluded.minimum_payout_minor,hold_until=excluded.hold_until,
 verified_at=case when excluded.onboarding_status='verified' then coalesce(public.marketplace_creator_payout_profiles.verified_at,now()) else null end,
 updated_by=auth.uid(),updated_at=now();
end; $$;
revoke all on function public.marketplace_set_creator_payout_profile(uuid,text,text,text,text,text,boolean,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_set_creator_payout_profile(uuid,text,text,text,text,text,boolean,bigint,timestamptz) to service_role;

-- Enforce provider onboarding, tax status, hold period and minimum payout at
-- request time (not just in UI); creator-row lock serializes competing holds.
create or replace function public.marketplace_request_payout(p_amount_minor bigint,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare creator public.marketplace_creators%rowtype; profile public.marketplace_creator_payout_profiles%rowtype;
 available bigint; payout_id uuid; prior public.marketplace_payout_requests%rowtype;
begin
 if p_amount_minor<=0 or p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 128 then raise exception 'invalid_payout_request'; end if;
 select * into creator from public.marketplace_creators where user_id=auth.uid() for update;
 if not found or creator.status<>'verified' then raise exception 'creator_not_eligible'; end if;
 select * into profile from public.marketplace_creator_payout_profiles where creator_id=creator.id;
 if not found or profile.onboarding_status<>'verified' or profile.tax_status not in ('complete','exempt') or not profile.payouts_enabled then raise exception 'payout_onboarding_incomplete'; end if;
 select * into prior from public.marketplace_payout_requests where creator_id=creator.id and idempotency_key=p_idempotency_key;
 if found then if prior.amount_minor<>p_amount_minor then raise exception 'payout_idempotency_conflict'; end if; return prior.id; end if;
 if profile.hold_until is not null and profile.hold_until>now() then raise exception 'payout_hold_active'; end if;
 if p_amount_minor<profile.minimum_payout_minor then raise exception 'payout_below_minimum'; end if;
 select coalesce(sum(case when entry_type in ('creator_earning','creator_earning_reversal','processor_fee','payment_fee','tax','payout') then amount_minor else 0 end),0)
 into available from public.marketplace_financial_ledger where creator_id=creator.id;
 select available-coalesce(sum(amount_minor),0) into available from public.marketplace_payout_requests
 where creator_id=creator.id and status in ('requested','under_review','approved','processing','on_hold');
 if p_amount_minor>available then raise exception 'insufficient_available_balance'; end if;
 insert into public.marketplace_payout_requests(creator_id,amount_minor,payout_provider,idempotency_key)
 values(creator.id,p_amount_minor,profile.provider,p_idempotency_key) returning id into payout_id;
 return payout_id;
end; $$;
revoke all on function public.marketplace_request_payout(bigint,text) from public,anon;
grant execute on function public.marketplace_request_payout(bigint,text) to authenticated;


-- Buyer subscription management surface: cancellation is an intent/outbox command,
-- not a fake provider cancellation. Provider adapter must confirm by webhook.
create table if not exists public.marketplace_subscription_commands (
 id uuid primary key default gen_random_uuid(),
 subscription_id uuid not null references public.marketplace_subscriptions(id) on delete restrict,
 buyer_user_id uuid not null references auth.users(id) on delete restrict,
 command text not null check(command in ('cancel_at_period_end')),
 idempotency_key text not null,
 status text not null default 'pending' check(status in ('pending','processing','succeeded','failed')),
 provider_command_id text,
 error_code text,
 requested_at timestamptz not null default now(),
 processed_at timestamptz,
 unique(subscription_id,idempotency_key)
);
alter table public.marketplace_subscription_commands enable row level security;
revoke all on public.marketplace_subscription_commands from anon,authenticated;
grant select,insert,update on public.marketplace_subscription_commands to service_role;
revoke update,delete on public.marketplace_subscription_commands from service_role;

create or replace function public.marketplace_my_subscriptions()
returns table(id uuid,product_id uuid,product_version_id uuid,status text,current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean,grace_until timestamptz,created_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select s.id,s.product_id,s.product_version_id,s.status,s.current_period_start,s.current_period_end,s.cancel_at_period_end,s.grace_until,s.created_at
 from public.marketplace_subscriptions s where s.buyer_user_id=auth.uid()
 order by s.created_at desc;
$$;
revoke all on function public.marketplace_my_subscriptions() from public,anon;
grant execute on function public.marketplace_my_subscriptions() to authenticated;

create or replace function public.marketplace_request_subscription_cancellation(p_subscription_id uuid,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare sub public.marketplace_subscriptions%rowtype; command_id uuid;
begin
 if auth.uid() is null or p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 128 then raise exception 'invalid_subscription_cancellation'; end if;
 select * into sub from public.marketplace_subscriptions where id=p_subscription_id and buyer_user_id=auth.uid() for update;
 if not found then raise exception 'subscription_not_found'; end if;
 if sub.status not in ('active','past_due') then raise exception 'subscription_not_cancellable'; end if;
 insert into public.marketplace_subscription_commands(subscription_id,buyer_user_id,command,idempotency_key)
 values(sub.id,auth.uid(),'cancel_at_period_end',p_idempotency_key)
 on conflict(subscription_id,idempotency_key) do nothing returning id into command_id;
 if command_id is null then select id into command_id from public.marketplace_subscription_commands where subscription_id=sub.id and idempotency_key=p_idempotency_key; end if;
 update public.marketplace_subscriptions set cancel_at_period_end=true,updated_at=now() where id=sub.id;
 return command_id;
end; $$;
revoke all on function public.marketplace_request_subscription_cancellation(uuid,text) from public,anon;
grant execute on function public.marketplace_request_subscription_cancellation(uuid,text) to authenticated;

-- Creator-facing payout history and statement listing remain caller-scoped.
create or replace function public.marketplace_my_payouts()
returns table(id uuid,amount_minor bigint,currency char(3),status text,requested_at timestamptz,reviewed_at timestamptz,processed_at timestamptz,failure_code text)
language sql stable security definer set search_path=public,pg_temp as $$
 select p.id,p.amount_minor,p.currency,p.status,p.requested_at,p.reviewed_at,p.processed_at,p.failure_code
 from public.marketplace_payout_requests p join public.marketplace_creators c on c.id=p.creator_id
 where c.user_id=auth.uid() order by p.requested_at desc;
$$;
revoke all on function public.marketplace_my_payouts() from public,anon;
grant execute on function public.marketplace_my_payouts() to authenticated;

create or replace function public.marketplace_my_creator_statements()
returns table(id uuid,period_start date,period_end date,currency char(3),gross_sales_minor bigint,commission_minor bigint,creator_earnings_minor bigint,reversals_minor bigint,fees_tax_minor bigint,payouts_minor bigint,net_payable_minor bigint,ledger_cutoff timestamptz,generated_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select s.id,s.period_start,s.period_end,s.currency,s.gross_sales_minor,s.commission_minor,s.creator_earnings_minor,s.reversals_minor,s.fees_tax_minor,s.payouts_minor,s.net_payable_minor,s.ledger_cutoff,s.generated_at
 from public.marketplace_creator_statements s join public.marketplace_creators c on c.id=s.creator_id
 where c.user_id=auth.uid() and c.status='verified' order by s.period_start desc;
$$;
revoke all on function public.marketplace_my_creator_statements() from public,anon;
grant execute on function public.marketplace_my_creator_statements() to authenticated;


create or replace function public.marketplace_update_subscription_command(
 p_command_id uuid,p_status text,p_provider_command_id text,p_error_code text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare command_row public.marketplace_subscription_commands%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'subscription_command_service_role_required'; end if;
 if p_status not in ('processing','succeeded','failed') then raise exception 'invalid_subscription_command_status'; end if;
 select * into command_row from public.marketplace_subscription_commands where id=p_command_id for update;
 if not found then raise exception 'subscription_command_not_found'; end if;
 if command_row.status='succeeded' then
  if p_status='succeeded' and command_row.provider_command_id is not distinct from p_provider_command_id then return jsonb_build_object('id',command_row.id,'status','succeeded','duplicate',true); end if;
  raise exception 'subscription_command_terminal';
 end if;
 if command_row.status='failed' and p_status='processing' then
  update public.marketplace_subscription_commands set status='processing',error_code=null,processed_at=null where id=command_row.id;
 elsif command_row.status in ('pending','processing') then
  update public.marketplace_subscription_commands set status=p_status,provider_command_id=coalesce(p_provider_command_id,provider_command_id),error_code=p_error_code,processed_at=case when p_status in ('succeeded','failed') then now() else null end where id=command_row.id;
 else raise exception 'subscription_command_transition_invalid'; end if;
 return jsonb_build_object('id',command_row.id,'status',p_status);
end; $$;
revoke all on function public.marketplace_update_subscription_command(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_update_subscription_command(uuid,text,text,text) to service_role;
