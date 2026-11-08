begin;
create or replace function public.marketplace_create_pending_subscription(p_buyer_id uuid,p_product_id uuid,p_version_id uuid,p_provider text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_products%rowtype;v public.marketplace_product_versions%rowtype;s public.marketplace_subscriptions%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'subscription_checkout_service_role_required';end if;
 if p_provider not in ('paystack','stripe') or length(trim(p_idempotency_key)) not between 8 and 128 then raise exception 'invalid_subscription_checkout';end if;
 select * into p from public.marketplace_products where id=p_product_id and status='published' for share;
 select * into v from public.marketplace_product_versions where id=p_version_id and product_id=p_product_id and verification_status='approved' for share;
 if p.id is null or v.id is null or p.current_version_id<>v.id or p.pricing_type<>'recurring' or p.price_minor<=0 or p.recurring_interval not in ('month','year') then raise exception 'recurring_product_version_required';end if;
 select * into s from public.marketplace_subscriptions where buyer_user_id=p_buyer_id and product_id=p_product_id and status='pending' and provider=p_provider for update;
 if found then return jsonb_build_object('subscription_id',s.id,'amount_minor',p.price_minor,'currency',p.currency,'interval',p.recurring_interval,'product_name',p.name,'product_slug',p.slug,'product_version_id',v.id);end if;
 insert into public.marketplace_subscriptions(buyer_user_id,product_id,product_version_id,provider,status) values(p_buyer_id,p.id,v.id,p_provider,'pending') returning * into s;
 return jsonb_build_object('subscription_id',s.id,'amount_minor',p.price_minor,'currency',p.currency,'interval',p.recurring_interval,'product_name',p.name,'product_slug',p.slug,'product_version_id',v.id);
end $$;
revoke all on function public.marketplace_create_pending_subscription(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_create_pending_subscription(uuid,uuid,uuid,text,text) to service_role;
commit;
