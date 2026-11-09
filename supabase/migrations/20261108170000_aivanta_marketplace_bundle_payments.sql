begin;
create table if not exists public.marketplace_bundle_purchases(
 id uuid primary key default gen_random_uuid(),buyer_user_id uuid not null references auth.users(id) on delete restrict,
 bundle_id uuid not null references public.marketplace_bundles(id) on delete restrict,bundle_version_id uuid not null references public.marketplace_bundle_versions(id) on delete restrict,
 creator_id uuid not null references public.marketplace_creators(id) on delete restrict,provider text not null check(provider in ('paystack','stripe')),
 provider_checkout_id text,provider_payment_id text,amount_minor bigint not null check(amount_minor>0),currency char(3) not null check(currency='USD'),
 status text not null default 'pending' check(status in ('pending','paid','refunded','disputed','failed')),
 idempotency_key text not null,created_at timestamptz not null default now(),paid_at timestamptz,refunded_at timestamptz,
 unique(buyer_user_id,idempotency_key),unique(provider,provider_payment_id)
);
create table if not exists public.marketplace_bundle_entitlements(
 id uuid primary key default gen_random_uuid(),buyer_user_id uuid not null references auth.users(id) on delete restrict,
 bundle_id uuid not null references public.marketplace_bundles(id) on delete restrict,purchase_id uuid not null unique references public.marketplace_bundle_purchases(id) on delete restrict,
 status text not null default 'active' check(status in ('active','revoked')),created_at timestamptz not null default now()
);
create table if not exists public.marketplace_bundle_payment_events(
 id uuid primary key default gen_random_uuid(),provider text not null,event_id text not null,event_type text not null,purchase_id uuid references public.marketplace_bundle_purchases(id) on delete restrict,
 payload_sha256 char(64) not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),processed_at timestamptz not null default now(),unique(provider,event_id)
);
alter table public.marketplace_bundle_purchases enable row level security;alter table public.marketplace_bundle_entitlements enable row level security;alter table public.marketplace_bundle_payment_events enable row level security;
revoke all on public.marketplace_bundle_purchases,public.marketplace_bundle_entitlements,public.marketplace_bundle_payment_events from anon,authenticated;
grant all on public.marketplace_bundle_purchases,public.marketplace_bundle_entitlements,public.marketplace_bundle_payment_events to service_role;
alter table public.marketplace_financial_ledger add column if not exists bundle_purchase_id uuid references public.marketplace_bundle_purchases(id) on delete restrict;
create unique index if not exists marketplace_bundle_ledger_event_type_idx on public.marketplace_financial_ledger(provider,provider_event_id,entry_type,bundle_purchase_id) where bundle_purchase_id is not null and provider is not null and provider_event_id is not null;
create or replace function public.marketplace_create_bundle_purchase(p_buyer uuid,p_bundle uuid,p_provider text,p_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.marketplace_bundles%rowtype;v public.marketplace_bundle_versions%rowtype;creator uuid;p public.marketplace_bundle_purchases%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'bundle_checkout_service_role_required';end if;
 if p_provider not in ('paystack','stripe') or length(trim(p_key)) not between 8 and 128 then raise exception 'invalid_bundle_checkout';end if;
 select * into b from public.marketplace_bundles where id=p_bundle and status='published' for share;select * into v from public.marketplace_bundle_versions where id=b.current_version_id and bundle_id=b.id and verification_status='approved' for share;
 if b.id is null or v.id is null or b.pricing_type<>'one_time' or b.price_minor<=0 then raise exception 'paid_bundle_required';end if;
 select c.id into creator from public.marketplace_creators c where c.id=b.creator_id and c.status='verified';if creator is null then raise exception 'bundle_creator_unverified';end if;
 select * into p from public.marketplace_bundle_purchases where buyer_user_id=p_buyer and idempotency_key=p_key for update;if found then if p.bundle_id<>p_bundle or p.provider<>p_provider then raise exception 'bundle_checkout_idempotency_conflict';end if;return jsonb_build_object('purchase_id',p.id,'amount_minor',p.amount_minor,'currency',p.currency,'bundle_name',b.title,'bundle_slug',b.slug,'bundle_version_id',p.bundle_version_id);end if;
 insert into public.marketplace_bundle_purchases(buyer_user_id,bundle_id,bundle_version_id,creator_id,provider,amount_minor,currency,idempotency_key) values(p_buyer,b.id,v.id,creator,p_provider,b.price_minor,b.currency,p_key) returning * into p;
 return jsonb_build_object('purchase_id',p.id,'amount_minor',p.amount_minor,'currency',p.currency,'bundle_name',b.title,'bundle_slug',b.slug,'bundle_version_id',v.id);
end $$;
create or replace function public.marketplace_finalize_bundle_payment(p_provider text,p_event_id text,p_purchase_id uuid,p_provider_payment_id text,p_amount bigint,p_currency text,p_hash text,p_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_bundle_purchases%rowtype;fee bigint;earning bigint;ev uuid;
begin
 if auth.role()<>'service_role' then raise exception 'bundle_payment_service_role_required';end if;
 if p_hash !~ '^[a-f0-9]{64}$' or p_amount<=0 or p_currency<>'USD' then raise exception 'invalid_bundle_payment';end if;
 select * into p from public.marketplace_bundle_purchases where id=p_purchase_id for update;if not found or p.provider<>p_provider or p.amount_minor<>p_amount or p.currency<>p_currency then raise exception 'bundle_payment_mismatch';end if;end if;
 if p.status='paid' then if p.provider_payment_id=p_provider_payment_id then return jsonb_build_object('status','duplicate_bundle_payment');end if;raise exception 'bundle_already_paid';end if;if p.status<>'pending' then raise exception 'bundle_purchase_not_pending';end if;
 insert into public.marketplace_bundle_payment_events(provider,event_id,event_type,purchase_id,payload_sha256) values(p_provider,p_event_id,'payment.succeeded',p.id,p_hash) on conflict(provider,event_id) do nothing returning id into ev;if ev is null then return jsonb_build_object('status','duplicate_event');end if;
 fee:=floor(p_amount*0.20);earning:=p_amount-fee;update public.marketplace_bundle_purchases set status='paid',provider_payment_id=p_provider_payment_id,paid_at=coalesce(p_at,now()) where id=p.id;
 insert into public.marketplace_bundle_entitlements(buyer_user_id,bundle_id,purchase_id) values(p.buyer_user_id,p.bundle_id,p.id) on conflict(purchase_id) do nothing;
 insert into public.marketplace_financial_ledger(bundle_purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo) values(p.id,p.creator_id,p_provider,p_event_id,'gross_sale',p_amount,p.currency,'Bundle sale'),(p.id,p.creator_id,p_provider,p_event_id,'platform_commission',fee,p.currency,'Aivanta 20% bundle commission'),(p.id,p.creator_id,p_provider,p_event_id,'creator_earning',earning,p.currency,'Creator 80% bundle earning');
 return jsonb_build_object('status','paid','bundle_purchase_id',p.id,'commission_minor',fee,'creator_earning_minor',earning);
end $$;
create or replace function public.marketplace_reverse_bundle_payment(p_provider text,p_event_id text,p_purchase_id uuid,p_kind text,p_amount bigint,p_hash text,p_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_bundle_purchases%rowtype;prior bigint;ev uuid;fee bigint;earning bigint;typ text;
begin
 if auth.role()<>'service_role' then raise exception 'bundle_reversal_service_role_required';end if;
 if p_kind not in ('refund','chargeback') or p_hash !~ '^[a-f0-9]{64}$' or p_amount<=0 then raise exception 'invalid_bundle_reversal';end if;
 select * into p from public.marketplace_bundle_purchases where id=p_purchase_id for update;if not found or p.provider<>p_provider or p.status not in ('paid','refunded','disputed') then raise exception 'bundle_purchase_not_reversible';end if;end if;
 if exists(select 1 from public.marketplace_bundle_payment_events where provider=p_provider and event_id=p_event_id) then return jsonb_build_object('status','duplicate_event');end if;
 select coalesce(sum(-amount_minor),0) into prior from public.marketplace_financial_ledger where bundle_purchase_id=p.id and entry_type in ('refund','chargeback');if prior+p_amount>p.amount_minor then raise exception 'bundle_reversal_exceeds_payment';end if;end if;
 insert into public.marketplace_bundle_payment_events(provider,event_id,event_type,purchase_id,payload_sha256) values(p_provider,p_event_id,p_kind,p.id,p_hash);
 fee:=floor(p_amount*0.20);earning:=p_amount-fee;insert into public.marketplace_financial_ledger(bundle_purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo) values(p.id,p.creator_id,p_provider,p_event_id,p_kind,-p_amount,p.currency,'Bundle provider reversal');
 insert into public.marketplace_financial_ledger(bundle_purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo) values(p.id,p.creator_id,p_provider,p_event_id,'platform_commission_reversal',-fee,p.currency,'Bundle commission reversal');
 insert into public.marketplace_financial_ledger(bundle_purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo) values(p.id,p.creator_id,p_provider,p_event_id,'creator_earning_reversal',-earning,p.currency,'Bundle creator earning reversal');
 update public.marketplace_bundle_purchases set status=case when p_kind='chargeback' then 'disputed' else 'refunded' end,refunded_at=case when p_kind='refund' then coalesce(p_at,now()) else refunded_at end where id=p.id;
 update public.marketplace_bundle_entitlements set status='revoked' where purchase_id=p.id;
 return jsonb_build_object('status',p_kind,'bundle_purchase_id',p.id);
end $$;
revoke all on function public.marketplace_create_bundle_purchase(uuid,uuid,text,text) from public,anon,authenticated;grant execute on function public.marketplace_create_bundle_purchase(uuid,uuid,text,text) to service_role;
revoke all on function public.marketplace_finalize_bundle_payment(text,text,uuid,text,bigint,text,text,timestamptz) from public,anon,authenticated;grant execute on function public.marketplace_finalize_bundle_payment(text,text,uuid,text,bigint,text,text,timestamptz) to service_role;
revoke all on function public.marketplace_reverse_bundle_payment(text,text,uuid,text,bigint,text,timestamptz) from public,anon,authenticated;grant execute on function public.marketplace_reverse_bundle_payment(text,text,uuid,text,bigint,text,timestamptz) to service_role;
commit;
