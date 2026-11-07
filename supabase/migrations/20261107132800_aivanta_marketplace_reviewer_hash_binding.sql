-- Bind reviewer decisions to the exact immutable artifact and authenticated reviewer.
-- The service-role API supplies the reviewer identity after checking the reviewer allowlist.
create or replace function public.marketplace_record_verification(
 p_product_id uuid,
 p_version_id uuid,
 p_status text,
 p_checks jsonb,
 p_notes text,
 p_reviewer_id uuid,
 p_artifact_sha256 text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v public.marketplace_product_versions;
 r uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_status not in ('approved','rejected') then raise exception 'invalid_verification_status'; end if;
 if p_reviewer_id is null or not exists(select 1 from auth.users where id=p_reviewer_id) then
  raise exception 'valid_reviewer_required';
 end if;
 if jsonb_typeof(p_checks)<>'array' then raise exception 'verification_checks_must_be_array'; end if;
 select * into v from public.marketplace_product_versions
 where id=p_version_id and product_id=p_product_id for update;
 if not found then raise exception 'version_not_found'; end if;
 if v.verification_status<>'pending' then raise exception 'version_already_reviewed'; end if;
 if p_artifact_sha256 is null or lower(p_artifact_sha256)<>v.artifact_sha256 then
  raise exception 'artifact_hash_mismatch';
 end if;
 if p_status='approved' and exists(
  select 1 from jsonb_array_elements(p_checks) as checks(value)
  where coalesce(value->>'passed','false')<>'true'
 ) then raise exception 'verification_checks_not_all_passed'; end if;
 update public.marketplace_product_versions
 set verification_status=p_status,
     verified_at=case when p_status='approved' then now() else null end,
     verified_by=p_reviewer_id
 where id=p_version_id;
 insert into public.marketplace_verification_reviews(
  product_id,version_id,review_type,status,checks,reviewer_id,notes,completed_at
 ) values(
  p_product_id,p_version_id,'human',
  case when p_status='approved' then 'approved' else 'rejected' end,
  p_checks,p_reviewer_id,coalesce(p_notes,''),now()
 ) returning id into r;
 -- Close the automated queue item so it cannot remain perpetually pending after human review.
 update public.marketplace_verification_reviews
 set status=case when p_status='approved' then 'passed' else 'failed' end,
     checks=p_checks,reviewer_id=p_reviewer_id,notes=coalesce(p_notes,''),completed_at=now()
 where id=(
  select id from public.marketplace_verification_reviews
  where product_id=p_product_id and version_id=p_version_id
    and review_type='automated' and status in ('queued','running')
  order by created_at desc limit 1 for update
 );
 if p_status='approved' then
  update public.marketplace_products set status='verified',current_version_id=p_version_id,updated_at=now()
  where id=p_product_id and status in ('submitted','verified');
 else
  update public.marketplace_products set status='rejected',updated_at=now()
  where id=p_product_id and status in ('submitted','verified');
 end if;
 if not found then raise exception 'product_not_in_reviewable_state'; end if;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(
  p_reviewer_id,
  case when p_status='approved' then 'marketplace_version_approved' else 'marketplace_version_rejected' end,
  'product',p_product_id,
  jsonb_build_object(
   'version_id',p_version_id,
   'artifact_sha256',v.artifact_sha256,
   'review_id',r,
   'checks',p_checks,
   'notes',left(coalesce(p_notes,''),2000)
  )
 );
 return jsonb_build_object(
  'review_id',r,'product_id',p_product_id,'version_id',p_version_id,
  'artifact_sha256',v.artifact_sha256,'reviewer_id',p_reviewer_id,
  'version_status',p_status,'reviewed_at',now()
 );
end $$;

revoke all on function public.marketplace_record_verification(uuid,uuid,text,jsonb,text,uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_record_verification(uuid,uuid,text,jsonb,text,uuid,text) to service_role;
-- Remove the earlier signature so no stale approval path remains callable.
drop function if exists public.marketplace_record_verification(uuid,uuid,text,jsonb,text);
