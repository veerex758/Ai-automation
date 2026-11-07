-- Tighten public version exposure: artifacts/manifests are never selectable by anon.
drop policy if exists marketplace_versions_public_read on public.marketplace_product_versions;
revoke all on public.marketplace_product_versions from anon;
revoke all on public.marketplace_product_versions from authenticated;
grant select,insert on public.marketplace_product_versions to authenticated;

create or replace view public.marketplace_public_product_versions
with (security_invoker=true) as
select v.id,v.product_id,v.version,v.artifact_sha256,v.verified_at
from public.marketplace_product_versions v
join public.marketplace_products p on p.id=v.product_id
where v.verification_status='approved' and p.status='published' and p.current_version_id=v.id;
grant select on public.marketplace_public_product_versions to anon,authenticated;

-- Keep review records readable only by the submitting creator and privileged backend.
revoke all on public.marketplace_verification_reviews from anon;
revoke insert,update,delete,truncate,references,trigger on public.marketplace_verification_reviews from authenticated,anon;
grant select on public.marketplace_verification_reviews to authenticated;
