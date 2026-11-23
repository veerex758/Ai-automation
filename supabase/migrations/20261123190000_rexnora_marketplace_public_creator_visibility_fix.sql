-- Storage/public artifact visibility must use the same creator trust gate as
-- marketplace_products_public_read. A published version from an unverified
-- creator must never become public merely because a reviewer published it.
create or replace function public.marketplace_product_is_public(p_product_id uuid,p_version_id uuid)
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
