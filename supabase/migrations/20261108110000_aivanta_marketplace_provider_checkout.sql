begin;
alter table public.marketplace_purchases add column if not exists checkout_idempotency_key text;
create unique index if not exists marketplace_purchase_checkout_idempotency_idx on public.marketplace_purchases(buyer_user_id,checkout_idempotency_key) where checkout_idempotency_key is not null;
create or replace function public.marketplace_create_checkout_purchase(p_product_id uuid,p_version_id uuid,p_buyer_id uuid,p_provider text,p_idempotency_key text)
returns table(purchase_id uuid,amount_minor integer,currency char(3),product_slug text,product_name text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_products%rowtype; v public.marketplace_product_versions%rowtype; existing public.marketplace_purchases%rowtype; new_id uuid;
begin
 if p_provider not in ('paystack','stripe') or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'invalid_checkout_request';end if;
 select * into existing from public.marketplace_purchases where buyer_user_id=p_buyer_id and checkout_idempotency_key=p_idempotency_key for update;
 if found then if existing.product_id<>p_product_id or existing.provider<>p_provider then raise exception 'idempotency_conflict';end if;
 select slug,name into product_slug,product_name from public.marketplace_products where id=existing.product_id;purchase_id:=existing.id;amount_minor:=existing.amount_minor;currency:=existing.currency;return next;return;end if;
 select * into p from public.marketplace_products where id=p_product_id and status='published' for share;
 select * into v from public.marketplace_product_versions where id=p_version_id and product_id=p_product_id and verification_status='approved' for share;
 if p.id is null or v.id is null or p.current_version_id<>v.id then raise exception 'product_version_not_approved';end if;
 if p.pricing_type='free' then raise exception 'free_product_checkout_not_required';end if;
 insert into public.marketplace_purchases(buyer_user_id,product_id,product_version_id,provider,amount_minor,currency,checkout_idempotency_key)
 values(p_buyer_id,p.id,v.id,p_provider,p.price_minor,p.currency,p_idempotency_key) returning id into new_id;
 purchase_id:=new_id;amount_minor:=p.price_minor;currency:=p.currency;product_slug:=p.slug;product_name:=p.name;return next;
end $$;
revoke all on function public.marketplace_create_checkout_purchase(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_create_checkout_purchase(uuid,uuid,uuid,text,text) to service_role;
commit;
