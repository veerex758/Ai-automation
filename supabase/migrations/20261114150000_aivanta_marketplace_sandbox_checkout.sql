-- Marketplace Priority 3: isolated sandbox checkout sessions. These never create purchases,
-- financial ledger entries, provider transactions, or paid entitlements.
create table if not exists public.marketplace_sandbox_checkout_sessions(
 id uuid primary key default gen_random_uuid(),
 buyer_user_id uuid not null references auth.users(id) on delete cascade,
 product_id uuid not null references public.marketplace_products(id) on delete restrict,
 product_version_id uuid not null references public.marketplace_product_versions(id) on delete restrict,
 amount_minor integer not null check(amount_minor>0),
 currency text not null default 'USD' check(currency='USD'),
 idempotency_key text not null check(length(idempotency_key) between 8 and 128),
 status text not null default 'pending' check(status in ('pending','simulated_success','cancelled')),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(buyer_user_id,idempotency_key)
);
alter table public.marketplace_sandbox_checkout_sessions enable row level security;
revoke all on public.marketplace_sandbox_checkout_sessions from public,anon,authenticated;
grant select on public.marketplace_sandbox_checkout_sessions to authenticated;
create policy marketplace_sandbox_checkout_owner_read on public.marketplace_sandbox_checkout_sessions
 for select to authenticated using(buyer_user_id=auth.uid());

create or replace function public.marketplace_create_sandbox_checkout(p_product_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid();p public.marketplace_products;v public.marketplace_product_versions;s public.marketplace_sandbox_checkout_sessions;
begin
 if uid is null then raise exception 'authentication_required'; end if;
 if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 128 then raise exception 'invalid_sandbox_idempotency_key';end if;
 select * into p from public.marketplace_products where id=p_product_id and status='published' for share;
 if not found or p.pricing_type='free' or p.current_version_id is null then raise exception 'sandbox_product_not_purchasable';end if;
 select * into v from public.marketplace_product_versions where id=p.current_version_id and product_id=p.id and verification_status='approved' for share;
 if not found then raise exception 'sandbox_version_not_approved';end if;
 insert into public.marketplace_sandbox_checkout_sessions(buyer_user_id,product_id,product_version_id,amount_minor,idempotency_key)
 values(uid,p.id,v.id,p.price_minor,trim(p_idempotency_key))
 on conflict(buyer_user_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
 returning * into s;
 return jsonb_build_object('session_id',s.id,'status',s.status,'amount_minor',s.amount_minor,'currency',s.currency,'product_version_id',s.product_version_id,'sandbox_only',true,'entitlement_created',false);
end $$;

create or replace function public.marketplace_complete_sandbox_checkout(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid();s public.marketplace_sandbox_checkout_sessions;
begin
 if uid is null then raise exception 'authentication_required';end if;
 update public.marketplace_sandbox_checkout_sessions set status='simulated_success',completed_at=now()
 where id=p_session_id and buyer_user_id=uid and status='pending' returning * into s;
 if not found then
  select * into s from public.marketplace_sandbox_checkout_sessions where id=p_session_id and buyer_user_id=uid;
  if not found then raise exception 'sandbox_session_not_found';end if;
  if s.status<>'simulated_success' then raise exception 'sandbox_session_not_pending';end if;
 end if;
 return jsonb_build_object('session_id',s.id,'status',s.status,'sandbox_only',true,'real_payment',false,'entitlement_created',false,'financial_ledger_written',false);
end $$;
revoke all on function public.marketplace_create_sandbox_checkout(uuid,text) from public,anon;
grant execute on function public.marketplace_create_sandbox_checkout(uuid,text) to authenticated;
revoke all on function public.marketplace_complete_sandbox_checkout(uuid) from public,anon;
grant execute on function public.marketplace_complete_sandbox_checkout(uuid) to authenticated;
