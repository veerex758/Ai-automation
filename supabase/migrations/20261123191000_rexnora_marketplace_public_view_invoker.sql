-- Replace the exposed SECURITY DEFINER visibility helper with a private,
-- schema-pinned helper. The public versions view becomes SECURITY INVOKER and
-- receives only safe column grants plus an RLS policy using the private helper.

create or replace function private.marketplace_product_is_public(p_product_id uuid,p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.marketplace_products p
    join public.marketplace_product_versions v
      on v.product_id=p.id and v.id=p.current_version_id
    left join public.marketplace_creators c on c.id=p.creator_id
    where p.id=p_product_id
      and p.current_version_id=p_version_id
      and p.status='published'
      and v.verification_status='approved'
      and (p.creator_id is null or c.status='verified')
  )
$function$;

revoke all on function private.marketplace_product_is_public(uuid,uuid) from public;
grant usage on schema private to anon,authenticated;
grant execute on function private.marketplace_product_is_public(uuid,uuid) to anon,authenticated;

drop function if exists public.marketplace_product_is_public(uuid,uuid);

-- Public product visibility is computed once by the private helper; authenticated
-- creators retain access to their own drafts through the combined policy.
drop policy if exists marketplace_creators_owner_read on public.marketplace_creators;
drop policy if exists marketplace_creators_public_read on public.marketplace_creators;
create policy marketplace_creators_read on public.marketplace_creators
 for select to authenticated
 using (user_id=(select auth.uid()) or status='verified');
create policy marketplace_creators_public_read on public.marketplace_creators
 for select to anon using (status='verified');

drop policy if exists marketplace_products_creator_read on public.marketplace_products;
drop policy if exists marketplace_products_public_read on public.marketplace_products;
create policy marketplace_products_read on public.marketplace_products
 for select to authenticated
 using (created_by=(select auth.uid()) or private.marketplace_product_is_public(id,current_version_id));
create policy marketplace_products_public_read on public.marketplace_products
 for select to anon using (private.marketplace_product_is_public(id,current_version_id));

-- Version rows remain private except for the verified current version of a
-- published product. The public view exposes only the five safe columns below.
drop policy if exists marketplace_versions_creator_read on public.marketplace_product_versions;
create policy marketplace_versions_read on public.marketplace_product_versions
 for select to authenticated
 using (created_by=(select auth.uid()) or private.marketplace_product_is_public(product_id,id));
create policy marketplace_versions_public_read on public.marketplace_product_versions
 for select to anon using (private.marketplace_product_is_public(product_id,id));

grant select (id,product_id,version,artifact_sha256,verified_at)
 on public.marketplace_product_versions to anon,authenticated;

create or replace view public.marketplace_public_product_versions
with (security_invoker=true)
as
select v.id,v.product_id,v.version,v.artifact_sha256,v.verified_at
from public.marketplace_product_versions v
where private.marketplace_product_is_public(v.product_id,v.id);

grant select on public.marketplace_public_product_versions to anon,authenticated;

-- Bundle and collection visibility must not bypass creator trust checks.
drop policy if exists marketplace_bundle_items_public_verified on public.marketplace_bundle_items;
create policy marketplace_bundle_items_public_verified on public.marketplace_bundle_items
 for select to anon,authenticated
 using (
   exists(select 1 from public.marketplace_bundles b where b.id=bundle_id and b.status='published')
   and private.marketplace_product_is_public(product_id,product_version_id)
 );

drop policy if exists marketplace_bundles_public_verified on public.marketplace_bundles;
create policy marketplace_bundles_public_verified on public.marketplace_bundles
 for select to anon,authenticated
 using (
   status='published'
   and exists(select 1 from public.marketplace_bundle_versions bv
     where bv.id=current_version_id and bv.verification_status='approved'
       and bv.manifest_sha256::text=encode(digest(bv.manifest::text,'sha256'),'hex'))
   and exists(select 1 from public.marketplace_bundle_items bi where bi.bundle_id=id)
   and not exists(select 1 from public.marketplace_bundle_items bi
     where bi.bundle_id=id and not private.marketplace_product_is_public(bi.product_id,bi.product_version_id))
 );

drop policy if exists marketplace_public_collection_items_read on public.marketplace_collection_products;
create policy marketplace_public_collection_items_read on public.marketplace_collection_products
 for select to anon,authenticated
 using (
   exists(select 1 from public.marketplace_collections c
     where c.id=collection_id and c.status='published' and c.published_at is not null and c.published_at<=now())
   and private.marketplace_product_is_public(product_id,
     (select p.current_version_id from public.marketplace_products p where p.id=product_id))
 );
