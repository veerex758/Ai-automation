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

-- Atomic payment finalization. Called only after a server verifies provider signature
-- and parses a payment event; it independently checks provider, purchase, amount,
-- currency, and idempotency before granting an entitlement.
create or replace function public.marketplace_finalize_payment(
 p_provider text,p_event_id text,p_purchase_id uuid,p_provider_payment_id text,
 p_amount_minor integer,p_currency text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare purchase public.marketplace_purchases%rowtype; creator uuid; commission bigint; earning bigint;
begin
 if p_provider is null or p_event_id is null or p_provider_payment_id is null then raise exception 'invalid_payment_event'; end if;
 if p_amount_minor<=0 or p_currency<>'USD' then raise exception 'invalid_payment_amount'; end if;
 select * into purchase from public.marketplace_purchases where id=p_purchase_id for update;
 if not found then raise exception 'purchase_not_found'; end if;
 if purchase.provider<>p_provider or purchase.amount_minor<>p_amount_minor or purchase.currency<>p_currency then raise exception 'payment_mismatch'; end if;
 if purchase.status='paid' then
   if purchase.provider_payment_id=p_provider_payment_id then return jsonb_build_object('status','already_paid','purchase_id',purchase.id); end if;
   raise exception 'purchase_already_paid';
 end if;
 if purchase.status<>'pending' then raise exception 'purchase_not_pending'; end if;
 if exists(select 1 from public.marketplace_purchases where provider_payment_id=p_provider_payment_id and id<>purchase.id) then raise exception 'payment_id_reused'; end if;
 select creator_id into creator from public.marketplace_products where id=purchase.product_id and status='published' and current_version_id=purchase.product_version_id;
 if not found then raise exception 'product_version_not_current_or_published'; end if;
 commission:=floor(p_amount_minor*0.20); earning:=p_amount_minor-commission;
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
revoke all on function public.marketplace_finalize_payment(text,text,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.marketplace_finalize_payment(text,text,uuid,text,integer,text) to service_role;
