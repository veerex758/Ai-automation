alter table public.marketplace_purchases add column if not exists creator_id uuid references public.marketplace_creators(id) on delete set null;
alter table public.marketplace_purchases add column if not exists platform_fee_minor integer not null default 0 check(platform_fee_minor>=0);
alter table public.marketplace_purchases add column if not exists creator_earning_minor integer not null default 0 check(creator_earning_minor>=0);
alter table public.marketplace_purchases add column if not exists payment_fee_minor integer not null default 0 check(payment_fee_minor>=0);
alter table public.marketplace_purchases add column if not exists tax_minor integer not null default 0 check(tax_minor>=0);

create table if not exists public.marketplace_payment_events(
 id uuid primary key default gen_random_uuid(),provider text not null,event_id text not null,event_type text not null,
 purchase_id uuid references public.marketplace_purchases(id) on delete restrict,payload_hash char(64),processed_at timestamptz,
 created_at timestamptz not null default now(),unique(provider,event_id)
);
create table if not exists public.marketplace_financial_ledger(
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.marketplace_payment_events(id) on delete restrict,
 purchase_id uuid references public.marketplace_purchases(id) on delete restrict,creator_id uuid references public.marketplace_creators(id) on delete restrict,
 entry_type text not null check(entry_type in ('gross_sale','platform_commission','creator_earning','payment_fee','tax','refund','chargeback','payout')),
 amount_minor bigint not null check(amount_minor>=0),currency char(3) not null default 'USD' check(currency='USD'),
 created_at timestamptz not null default now()
);
alter table public.marketplace_payment_events enable row level security;
alter table public.marketplace_financial_ledger enable row level security;
revoke all on public.marketplace_payment_events,public.marketplace_financial_ledger from anon,authenticated;
grant select,insert on public.marketplace_payment_events,public.marketplace_financial_ledger to service_role;
create index if not exists marketplace_ledger_creator_idx on public.marketplace_financial_ledger(creator_id,created_at desc);
create index if not exists marketplace_ledger_purchase_idx on public.marketplace_financial_ledger(purchase_id,created_at);

create or replace function public.marketplace_record_paid_purchase(p_purchase_id uuid,p_provider text,p_event_id text,p_payment_id text,p_payment_fee_minor integer default 0,p_tax_minor integer default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_purchases; product public.marketplace_products; ev uuid; commission integer; creator_net integer;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_provider is null or length(trim(p_provider))=0 or p_event_id is null or length(trim(p_event_id))=0 then raise exception 'provider_event_required'; end if;
 insert into public.marketplace_payment_events(provider,event_id,event_type,purchase_id) values(p_provider,p_event_id,'payment.succeeded',p_purchase_id) on conflict(provider,event_id) do nothing returning id into ev;
 if ev is null then return jsonb_build_object('duplicate',true); end if;
 select * into p from public.marketplace_purchases where id=p_purchase_id for update;
 if not found or p.status<>'pending' then raise exception 'purchase_not_pending'; end if;
 select * into product from public.marketplace_products where id=p.product_id and status='published' and current_version_id=p.product_version_id;
 if not found or not exists(select 1 from public.marketplace_product_versions v where v.id=p.product_version_id and v.verification_status='approved') then raise exception 'product_version_not_verified'; end if;
 if p.amount_minor<>product.price_minor or p.currency<>'USD' then raise exception 'purchase_amount_mismatch'; end if;
 commission:=floor(p.amount_minor*0.20)::integer;creator_net:=p.amount_minor-commission;
 update public.marketplace_purchases set status='paid',provider_payment_id=p_payment_id,creator_id=product.creator_id,platform_fee_minor=commission,creator_earning_minor=case when product.creator_id is null then 0 else creator_net end,payment_fee_minor=greatest(p_payment_fee_minor,0),tax_minor=greatest(p_tax_minor,0),paid_at=now() where id=p.id;
 insert into public.marketplace_financial_ledger(event_id,purchase_id,creator_id,entry_type,amount_minor) values
 (ev,p.id,product.creator_id,'gross_sale',p.amount_minor),
 (ev,p.id,null,'platform_commission',commission);
 if product.creator_id is not null then insert into public.marketplace_financial_ledger(event_id,purchase_id,creator_id,entry_type,amount_minor) values(ev,p.id,product.creator_id,'creator_earning',creator_net); end if;
 insert into public.marketplace_entitlements(user_id,product_id,purchase_id,entitlement_type,status) values(p.buyer_user_id,p.product_id,p.id,case when product.pricing_type='recurring' then 'subscription' else 'purchase' end,'active') on conflict(user_id,product_id,purchase_id) do nothing;
 update public.marketplace_payment_events set processed_at=now() where id=ev;
 return jsonb_build_object('purchase_id',p.id,'gross_minor',p.amount_minor,'platform_commission_minor',commission,'creator_earning_minor',creator_net,'status','paid');
end $$;
revoke all on function public.marketplace_record_paid_purchase(uuid,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.marketplace_record_paid_purchase(uuid,text,text,text,integer,integer) to service_role;

create or replace function public.marketplace_record_refund(p_purchase_id uuid,p_provider text,p_event_id text,p_refund_minor integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_purchases;ev uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_refund_minor<=0 then raise exception 'refund_amount_invalid'; end if;
 insert into public.marketplace_payment_events(provider,event_id,event_type,purchase_id) values(p_provider,p_event_id,'payment.refunded',p_purchase_id) on conflict(provider,event_id) do nothing returning id into ev;
 if ev is null then return jsonb_build_object('duplicate',true); end if;
 select * into p from public.marketplace_purchases where id=p_purchase_id for update;
 if not found or p.status not in ('paid','disputed') or p_refund_minor>p.amount_minor then raise exception 'refund_not_allowed'; end if;
 update public.marketplace_purchases set status='refunded',refunded_at=now() where id=p.id;
 update public.marketplace_entitlements set status='revoked' where purchase_id=p.id and status='active';
 insert into public.marketplace_financial_ledger(event_id,purchase_id,creator_id,entry_type,amount_minor) values(ev,p.id,null,'refund',p_refund_minor);
 update public.marketplace_payment_events set processed_at=now() where id=ev;
 return jsonb_build_object('purchase_id',p.id,'refund_minor',p_refund_minor,'status','refunded');
end $$;
revoke all on function public.marketplace_record_refund(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.marketplace_record_refund(uuid,text,text,integer) to service_role;
