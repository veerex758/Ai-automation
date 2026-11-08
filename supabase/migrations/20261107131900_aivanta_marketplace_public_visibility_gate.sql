create or replace function public.marketplace_product_is_public(p_product_id uuid,p_version_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.marketplace_products p join public.marketplace_product_versions v on v.product_id=p.id and v.id=p.current_version_id
 where p.id=p_product_id and p.current_version_id=p_version_id and p.status='published' and v.verification_status='approved')
$$;
revoke all on function public.marketplace_product_is_public(uuid,uuid) from public;
grant execute on function public.marketplace_product_is_public(uuid,uuid) to anon,authenticated;
drop policy if exists marketplace_products_public_read on public.marketplace_products;
create policy marketplace_products_public_read on public.marketplace_products for select to anon,authenticated using (public.marketplace_product_is_public(id,current_version_id));
drop policy if exists marketplace_versions_creator_read on public.marketplace_product_versions;
create policy marketplace_versions_creator_read on public.marketplace_product_versions for select to authenticated using (exists(select 1 from public.marketplace_products p where p.id=product_id and p.created_by=auth.uid()));
drop policy if exists marketplace_versions_creator_insert on public.marketplace_product_versions;
create policy marketplace_versions_creator_insert on public.marketplace_product_versions for insert to authenticated with check (created_by=auth.uid() and exists(select 1 from public.marketplace_products p where p.id=product_id and p.created_by=auth.uid() and p.status in ('draft','changes_requested')));
