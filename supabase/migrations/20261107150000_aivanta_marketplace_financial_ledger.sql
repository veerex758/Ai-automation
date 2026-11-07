-- Marketplace Phase 2 financial ledger foundation. Reversible by a reviewed forward migration; staging replay required.
-- Provider webhook inbox is durable and unique per provider event.
-- Earlier Phase 1/2 migration created a narrower inbox; evolve it in place.
alter table public.marketplace_payment_events add column if not exists provider_event_id text;
update public.marketplace_payment_events set provider_event_id=event_id where provider_event_id is null;
alter table public.marketplace_payment_events alter column provider_event_id set not null;
alter table public.marketplace_payment_events add column if not exists payload_sha256 char(64);
alter table public.marketplace_payment_events add column if not exists received_at timestamptz not null default now();
alter table public.marketplace_payment_events add column if not exists occurred_at timestamptz;
alter table public.marketplace_payment_events add column if not exists processing_status text not null default 'received';
alter table public.marketplace_payment_events add column if not exists error_code text;
alter table public.marketplace_payment_events drop constraint if exists marketplace_payment_events_provider_provider_event_id_key;
create unique index if not exists marketplace_payment_events_provider_event_id_idx on public.marketplace_payment_events(provider,provider_event_id);
create index if not exists marketplace_events_status_idx on public.marketplace_payment_events(processing_status,received_at);
-- Upgrade the legacy Phase 1 ledger/inbox in place (never assume IF NOT EXISTS changes shape).
alter table public.marketplace_payment_events alter column event_id drop not null;
alter table public.marketplace_payment_events add column if not exists provider_event_id text;
update public.marketplace_payment_events set provider_event_id=event_id where provider_event_id is null;
alter table public.marketplace_payment_events alter column provider_event_id set not null;
alter table public.marketplace_payment_events add column if not exists payload_sha256 char(64);
alter table public.marketplace_payment_events add column if not exists received_at timestamptz not null default now();
alter table public.marketplace_payment_events add column if not exists occurred_at timestamptz;
alter table public.marketplace_payment_events add column if not exists processing_status text not null default 'received';
alter table public.marketplace_payment_events add column if not exists error_code text;
alter table public.marketplace_payment_events drop constraint if exists marketplace_payment_events_provider_event_id_key;
alter table public.marketplace_payment_events drop constraint if exists marketplace_payment_events_provider_provider_event_id_key;
create unique index if not exists marketplace_payment_events_provider_event_id_idx on public.marketplace_payment_events(provider,provider_event_id);
create index if not exists marketplace_events_status_idx on public.marketplace_payment_events(processing_status,received_at);

-- Legacy ledger has event_id NOT NULL, nonnegative amounts, and an old entry_type check.
alter table public.marketplace_financial_ledger alter column event_id drop not null;
alter table public.marketplace_financial_ledger add column if not exists provider text;
alter table public.marketplace_financial_ledger add column if not exists provider_event_id text;
alter table public.marketplace_financial_ledger add column if not exists memo text not null default '';
alter table public.marketplace_financial_ledger add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.marketplace_financial_ledger drop constraint if exists marketplace_financial_ledger_entry_type_check;
alter table public.marketplace_financial_ledger drop constraint if exists marketplace_financial_ledger_amount_minor_check;
alter table public.marketplace_financial_ledger drop constraint if exists marketplace_financial_ledger_amount_check;
alter table public.marketplace_financial_ledger drop constraint if exists marketplace_financial_ledger_currency_check;
alter table public.marketplace_financial_ledger add constraint marketplace_financial_ledger_entry_type_check
 check(entry_type in ('gross_sale','platform_commission','creator_earning','processor_fee','payment_fee','tax','refund','chargeback','payout','adjustment','platform_commission_reversal','creator_earning_reversal'));
alter table public.marketplace_financial_ledger add constraint marketplace_financial_ledger_amount_nonzero_check check(amount_minor<>0);
create unique index if not exists marketplace_ledger_provider_event_type_purchase_idx
 on public.marketplace_financial_ledger(provider,provider_event_id,entry_type,purchase_id) where provider is not null and provider_event_id is not null;

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

-- Atomic payment finalization. Called only after a server verifies provider signature
-- and parses a payment event; it independently checks provider, purchase, amount,
-- currency, and idempotency before granting an entitlement.
create or replace function public.marketplace_finalize_payment(
 p_provider text,p_event_id text,p_purchase_id uuid,p_provider_payment_id text,
 p_amount_minor integer,p_currency text,p_payload_sha256 text,p_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare purchase public.marketplace_purchases%rowtype; creator uuid; commission bigint; earning bigint;
begin
 if p_provider is null or p_event_id is null or p_provider_payment_id is null then raise exception 'invalid_payment_event'; end if;
 if p_amount_minor<=0 or p_currency<>'USD' then raise exception 'invalid_payment_amount'; end if;
 if p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid_event_hash'; end if;
 select * into purchase from public.marketplace_purchases where id=p_purchase_id for update;
 if not found then raise exception 'purchase_not_found'; end if;
 if purchase.provider<>p_provider or purchase.amount_minor<>p_amount_minor or purchase.currency<>p_currency then raise exception 'payment_mismatch'; end if;
 if purchase.status='paid' then
  if purchase.provider_payment_id=p_provider_payment_id then return jsonb_build_object('status','already_paid','purchase_id',purchase.id); end if;
  raise exception 'purchase_already_paid';
 end if;
 if purchase.status<>'pending' then raise exception 'purchase_not_pending'; end if;
 if exists(select 1 from public.marketplace_purchases where provider_payment_id=p_provider_payment_id and id<>purchase.id) then raise exception 'payment_id_reused'; end if;
 select mp.creator_id into creator from public.marketplace_products mp join public.marketplace_product_versions mv on mv.id=mp.current_version_id and mv.product_id=mp.id and mv.verification_status='approved' where mp.id=purchase.product_id and mp.status='published' and mp.current_version_id=purchase.product_version_id;
 if not found then raise exception 'product_version_not_current_or_published'; end if;
 commission:=floor(p_amount_minor*0.20); earning:=p_amount_minor-commission;
 insert into public.marketplace_payment_events(provider,provider_event_id,event_type,payload_sha256,occurred_at,processing_status,processed_at) values(p_provider,p_event_id,'payment.succeeded',p_payload_sha256,coalesce(p_occurred_at,now()),'processed',now());
 update public.marketplace_purchases set status='paid',provider_payment_id=p_provider_payment_id,paid_at=now() where id=purchase.id;
 insert into public.marketplace_entitlements(user_id,product_id,purchase_id,entitlement_type,status)
 values(purchase.buyer_user_id,purchase.product_id,purchase.id,'purchase','active')
 on conflict(user_id,product_id,purchase_id) do nothing;
 insert into public.marketplace_financial_ledger(purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo)
 values
 (purchase.id,creator,p_provider,p_event_id,'gross_sale',p_amount_minor,p_currency,'Verified marketplace payment'),
 (purchase.id,creator,p_provider,p_event_id,'platform_commission',commission,p_currency,'Aivanta 20% commission'),
 (purchase.id,creator,p_provider,p_event_id,'creator_earning',earning,p_currency,'Creator 80% gross share before fees/tax/adjustments');
 return jsonb_build_object('status','paid','purchase_id',purchase.id,'commission_minor',commission,'creator_earning_minor',earning);
end; $$;
revoke all on function public.marketplace_finalize_payment(text,text,uuid,text,integer,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_finalize_payment(text,text,uuid,text,integer,text,text,timestamptz) to service_role;

-- Refund/chargeback reversal: purchase lock + cumulative cap across both reversal types.
create or replace function public.marketplace_reverse_payment(
 p_provider text,p_event_id text,p_purchase_id uuid,p_kind text,
 p_amount_minor integer,p_payload_sha256 text,p_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare purchase public.marketplace_purchases%rowtype; creator uuid; prior_refund bigint; prior_chargeback bigint; target_status text;
begin
 if p_provider is null or p_event_id is null or p_kind not in ('refund','chargeback') then raise exception 'invalid_reversal_kind'; end if;
 if p_amount_minor<=0 or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid_reversal'; end if;
 select * into purchase from public.marketplace_purchases where id=p_purchase_id for update;
 if not found then raise exception 'purchase_not_found'; end if;
 if purchase.provider<>p_provider or purchase.provider_payment_id is null or purchase.status not in ('paid','refunded','disputed') then raise exception 'purchase_not_reversible'; end if;
 if exists(select 1 from public.marketplace_payment_events where provider=p_provider and provider_event_id=p_event_id) then return jsonb_build_object('status','duplicate_event','purchase_id',purchase.id); end if;
 select creator_id into creator from public.marketplace_products where id=purchase.product_id;
 select coalesce(sum(-amount_minor),0) into prior_refund from public.marketplace_financial_ledger where purchase_id=purchase.id and entry_type='refund';
 select coalesce(sum(-amount_minor),0) into prior_chargeback from public.marketplace_financial_ledger where purchase_id=purchase.id and entry_type='chargeback';
 if p_kind='refund' and prior_refund+p_amount_minor>purchase.amount_minor-prior_chargeback then raise exception 'refund_exceeds_paid_amount'; end if;
 if p_kind='chargeback' and prior_chargeback+p_amount_minor>purchase.amount_minor-prior_refund then raise exception 'chargeback_exceeds_paid_amount'; end if;
 target_status:=case when p_kind='chargeback' then 'disputed' when prior_refund+prior_chargeback+p_amount_minor>=purchase.amount_minor then 'refunded' else purchase.status end;
 insert into public.marketplace_payment_events(provider,provider_event_id,event_type,payload_sha256,occurred_at,processing_status,processed_at)
 values(p_provider,p_event_id,p_kind,p_payload_sha256,coalesce(p_occurred_at,now()),'processed',now());
 insert into public.marketplace_financial_ledger(purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo)
 values(purchase.id,creator,p_provider,p_event_id,p_kind,-p_amount_minor,purchase.currency,'Provider-confirmed marketplace reversal');
 insert into public.marketplace_financial_ledger(purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo)
 values(purchase.id,creator,p_provider,p_event_id,'platform_commission',-floor(p_amount_minor*0.20),purchase.currency,'Commission reversal'),
 (purchase.id,creator,p_provider,p_event_id,'creator_earning',-(p_amount_minor-floor(p_amount_minor*0.20)),purchase.currency,'Creator earning reversal');
 update public.marketplace_purchases set status=target_status,refunded_at=case when target_status='refunded' then now() else refunded_at end where id=purchase.id;
 if target_status in ('refunded','disputed') then update public.marketplace_entitlements set status='revoked' where purchase_id=purchase.id; end if;
 return jsonb_build_object('status',target_status,'purchase_id',purchase.id,'reversed_minor',p_amount_minor);
end; $$;
revoke all on function public.marketplace_reverse_payment(text,text,uuid,text,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_reverse_payment(text,text,uuid,text,integer,text,timestamptz) to service_role;
-- Provider inbox remains immutable after event processing.
revoke update,delete on public.marketplace_payment_events from service_role;

-- Provider-neutral reconciliation report. Returns only discrepancies; operators
-- compare this against provider settlement exports before payout eligibility.
create or replace function public.marketplace_financial_reconciliation()
returns table(purchase_id uuid,purchase_status text,purchase_amount_minor bigint,
 ledger_gross_minor bigint,ledger_reversal_minor bigint,net_gross_minor bigint,
 discrepancy_minor bigint)
language sql stable security definer set search_path=public,pg_temp as $$
 select p.id,p.status,p.amount_minor::bigint,
  coalesce(sum(case when l.entry_type='gross_sale' then l.amount_minor else 0 end),0)::bigint,
  coalesce(sum(case when l.entry_type in ('refund','chargeback') then -l.amount_minor else 0 end),0)::bigint,
  coalesce(sum(case when l.entry_type in ('gross_sale','refund','chargeback') then l.amount_minor else 0 end),0)::bigint,
  (case when p.status in ('paid','refunded','disputed') then p.amount_minor::bigint else 0 end)-
  coalesce(sum(case when l.entry_type in ('gross_sale','refund','chargeback') then l.amount_minor else 0 end),0)::bigint
 from public.marketplace_purchases p
 left join public.marketplace_financial_ledger l on l.purchase_id=p.id
 group by p.id,p.status,p.amount_minor
 having (case when p.status in ('paid','refunded','disputed') then p.amount_minor::bigint else 0 end) <>
  coalesce(sum(case when l.entry_type in ('gross_sale','refund','chargeback') then l.amount_minor else 0 end),0)
 order by p.created_at;
$$;
revoke all on function public.marketplace_financial_reconciliation() from public,anon,authenticated;
grant execute on function public.marketplace_financial_reconciliation() to service_role;
