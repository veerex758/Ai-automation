-- Public product pages may read only the explicitly projected, published and approved
-- version metadata. Keep the underlying manifest table private to authenticated owners.
create or replace view public.marketplace_public_product_versions
with (security_invoker=false) as
select v.id,v.product_id,v.version,v.artifact_sha256,v.verified_at
from public.marketplace_product_versions v
join public.marketplace_products p on p.id=v.product_id
where v.verification_status='approved'
  and p.status='published'
  and p.current_version_id=v.id;
revoke all on public.marketplace_public_product_versions from public;
grant select on public.marketplace_public_product_versions to anon,authenticated;
