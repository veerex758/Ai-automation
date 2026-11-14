-- Marketplace verification hardening: independent review, revocation and reverification.
create or replace function public.marketplace_record_verification(
 p_product_id uuid,p_version_id uuid,p_status text,p_checks jsonb,p_notes text,
 p_reviewer_id uuid,p_artifact_sha256 text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.marketplace_product_versions; p public.marketplace_products; r uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_status not in ('approved','rejected','changes_requested') then raise exception 'invalid_verification_status'; end if;
 if p_reviewer_id is null or not exists(select 1 from auth.users where id=p_reviewer_id) then raise exception 'valid_reviewer_required'; end if;
 if jsonb_typeof(p_checks)<>'array' then raise exception 'verification_checks_must_be_array'; end if;
 select * into v from public.marketplace_product_versions where id=p_version_id and product_id=p_product_id for update;
 if not found then raise exception 'version_not_found'; end if;
 select * into p from public.marketplace_products where id=p_product_id for update;
 if not found then raise exception 'product_not_found'; end if;
 if p_reviewer_id=v.created_by or p_reviewer_id=p.created_by
   or exists(select 1 from public.marketplace_creators c where c.id=p.creator_id and c.user_id=p_reviewer_id) then
  raise exception 'independent_reviewer_required';
 end if;
 if v.verification_status<>'pending' then raise exception 'version_already_reviewed'; end if;
 if p_artifact_sha256 is null or lower(p_artifact_sha256)<>v.artifact_sha256 then raise exception 'artifact_hash_mismatch'; end if;
 if p_status='approved' and (jsonb_array_length(p_checks)=0 or exists(
  select 1 from jsonb_array_elements(p_checks) as checks(value) where coalesce(value->>'passed','false')<>'true'
 )) then raise exception 'verification_checks_not_all_passed'; end if;
 update public.marketplace_product_versions set verification_status=case when p_status='approved' then 'approved' else 'rejected' end,
  verified_at=case when p_status='approved' then now() else null end,verified_by=p_reviewer_id where id=p_version_id;
 insert into public.marketplace_verification_reviews(product_id,version_id,review_type,status,checks,reviewer_id,notes,completed_at)
 values(p_product_id,p_version_id,'human',case when p_status='approved' then 'approved' when p_status='changes_requested' then 'changes_requested' else 'rejected' end,p_checks,p_reviewer_id,left(coalesce(p_notes,''),2000),now()) returning id into r;
 update public.marketplace_verification_reviews set status=case when p_status='approved' then 'passed' else 'failed' end,
  checks=p_checks,reviewer_id=p_reviewer_id,notes=left(coalesce(p_notes,''),2000),completed_at=now()
 where id=(select id from public.marketplace_verification_reviews where product_id=p_product_id and version_id=p_version_id
  and review_type in ('automated','reverification') and status in ('queued','running') order by created_at desc limit 1 for update);
 if p_status='approved' then
  update public.marketplace_products set status='verified',current_version_id=p_version_id,updated_at=now() where id=p_product_id and status in ('submitted','verified');
 elsif p_status='changes_requested' then
  update public.marketplace_products set status='changes_requested',updated_at=now() where id=p_product_id and status in ('submitted','verified');
 else
  update public.marketplace_products set status='rejected',updated_at=now() where id=p_product_id and status in ('submitted','verified');
 end if;
 if not found then raise exception 'product_not_in_reviewable_state'; end if;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(p_reviewer_id,'marketplace_version_'||case when p_status='approved' then 'approved' when p_status='changes_requested' then 'changes_requested' else 'rejected' end,
 'product',p_product_id,jsonb_build_object('version_id',p_version_id,'artifact_sha256',v.artifact_sha256,'review_id',r,'checks',p_checks,'notes',left(coalesce(p_notes,''),2000)));
 return jsonb_build_object('review_id',r,'product_id',p_product_id,'version_id',p_version_id,'artifact_sha256',v.artifact_sha256,'reviewer_id',p_reviewer_id,'version_status',p_status,'reviewed_at',now());
end $$;
revoke all on function public.marketplace_record_verification(uuid,uuid,text,jsonb,text,uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_record_verification(uuid,uuid,text,jsonb,text,uuid,text) to service_role;

create or replace function public.marketplace_revoke_version(p_product_id uuid,p_version_id uuid,p_reviewer_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.marketplace_product_versions; p public.marketplace_products; r uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_reviewer_id is null or length(trim(coalesce(p_reason,'')))<5 then raise exception 'reviewer_and_reason_required'; end if;
 select * into v from public.marketplace_product_versions where id=p_version_id and product_id=p_product_id for update;
 if not found or v.verification_status<>'approved' then raise exception 'approved_version_required'; end if;
 select * into p from public.marketplace_products where id=p_product_id for update;
 if not found or (p_reviewer_id=v.created_by or p_reviewer_id=p.created_by
  or exists(select 1 from public.marketplace_creators c where c.id=p.creator_id and c.user_id=p_reviewer_id)) then raise exception 'independent_reviewer_required'; end if;
 update public.marketplace_product_versions set verification_status='revoked',verified_at=null,verified_by=p_reviewer_id where id=p_version_id;
 update public.marketplace_products set status='revoked',updated_at=now() where id=p_product_id and current_version_id=p_version_id;
 insert into public.marketplace_verification_reviews(product_id,version_id,review_type,status,reviewer_id,notes,completed_at)
 values(p_product_id,p_version_id,'human','rejected',p_reviewer_id,left(trim(p_reason),2000),now()) returning id into r;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(p_reviewer_id,'marketplace_version_revoked','product',p_product_id,jsonb_build_object('version_id',p_version_id,'artifact_sha256',v.artifact_sha256,'reason',left(trim(p_reason),2000),'review_id',r));
 return jsonb_build_object('product_id',p_product_id,'version_id',p_version_id,'status','revoked','review_id',r);
end $$;
revoke all on function public.marketplace_revoke_version(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_revoke_version(uuid,uuid,uuid,text) to service_role;

create or replace function public.marketplace_require_reverification(p_product_id uuid,p_version_id uuid,p_reviewer_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.marketplace_product_versions; p public.marketplace_products; r uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_reviewer_id is null or length(trim(coalesce(p_reason,'')))<5 then raise exception 'reviewer_and_reason_required'; end if;
 select * into v from public.marketplace_product_versions where id=p_version_id and product_id=p_product_id for update;
 if not found or v.verification_status<>'revoked' then raise exception 'revoked_version_required'; end if;
 select * into p from public.marketplace_products where id=p_product_id for update;
 if not found or (p_reviewer_id=v.created_by or p_reviewer_id=p.created_by
  or exists(select 1 from public.marketplace_creators c where c.id=p.creator_id and c.user_id=p_reviewer_id)) then raise exception 'independent_reviewer_required'; end if;
 update public.marketplace_product_versions set verification_status='pending',verified_at=null,verified_by=null where id=p_version_id;
 update public.marketplace_products set status='submitted',current_version_id=p_version_id,updated_at=now() where id=p_product_id;
 insert into public.marketplace_verification_reviews(product_id,version_id,review_type,status,notes)
 values(p_product_id,p_version_id,'reverification','queued',left(trim(p_reason),2000)) returning id into r;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(p_reviewer_id,'marketplace_reverification_required','product',p_product_id,jsonb_build_object('version_id',p_version_id,'artifact_sha256',v.artifact_sha256,'reason',left(trim(p_reason),2000),'review_id',r));
 return jsonb_build_object('product_id',p_product_id,'version_id',p_version_id,'status','pending','review_id',r);
end $$;
revoke all on function public.marketplace_require_reverification(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_require_reverification(uuid,uuid,uuid,text) to service_role;
