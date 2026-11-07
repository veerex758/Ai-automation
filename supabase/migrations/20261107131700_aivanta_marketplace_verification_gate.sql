-- Trusted submission transition. Creator cannot directly mark a listing verified/published.
create or replace function public.submit_marketplace_product(p_product_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_products; v public.marketplace_product_versions;
begin
 select * into p from public.marketplace_products where id=p_product_id and created_by=auth.uid() for update;
 if not found then raise exception 'product_not_found_or_not_owned'; end if;
 if p.status not in ('draft','changes_requested') then raise exception 'product_not_submittable'; end if;
 select * into v from public.marketplace_product_versions where id=p_version_id and product_id=p_product_id and created_by=auth.uid();
 if not found or v.verification_status<>'pending' then raise exception 'version_not_submittable'; end if;
 update public.marketplace_products set status='submitted',current_version_id=p_version_id,updated_at=now() where id=p_product_id;
 insert into public.marketplace_verification_reviews(product_id,version_id,review_type,status)
 values(p_product_id,p_version_id,'automated','queued');
 return jsonb_build_object('product_id',p_product_id,'version_id',p_version_id,'status','submitted');
end $$;
revoke all on function public.submit_marketplace_product(uuid,uuid) from public,anon;
grant execute on function public.submit_marketplace_product(uuid,uuid) to authenticated;

-- Only service_role may record verification decisions or publication.
create or replace function public.marketplace_record_verification(
 p_product_id uuid,p_version_id uuid,p_status text,p_checks jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.marketplace_product_versions; r uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_status not in ('approved','rejected') then raise exception 'invalid_verification_status'; end if;
 select * into v from public.marketplace_product_versions where id=p_version_id and product_id=p_product_id for update;
 if not found then raise exception 'version_not_found'; end if;
 update public.marketplace_product_versions set verification_status=p_status,verified_at=case when p_status='approved' then now() else null end,verified_by=auth.uid() where id=p_version_id;
 insert into public.marketplace_verification_reviews(product_id,version_id,review_type,status,checks,reviewer_id,notes,completed_at)
 values(p_product_id,p_version_id,'human',case when p_status='approved' then 'approved' else 'rejected' end,coalesce(p_checks,'[]'::jsonb),auth.uid(),coalesce(p_notes,''),now()) returning id into r;
 if p_status='approved' then
  update public.marketplace_products set status='verified',current_version_id=p_version_id,updated_at=now() where id=p_product_id and status in ('submitted','verified');
 else
  update public.marketplace_products set status='rejected',updated_at=now() where id=p_product_id and status in ('submitted','verified');
 end if;
 return jsonb_build_object('review_id',r,'version_status',p_status);
end $$;
revoke all on function public.marketplace_record_verification(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketplace_record_verification(uuid,uuid,text,jsonb,text) to service_role;

create or replace function public.marketplace_publish_product(p_product_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if not exists(select 1 from public.marketplace_product_versions where id=p_version_id and product_id=p_product_id and verification_status='approved') then raise exception 'version_not_verified'; end if;
 update public.marketplace_products set status='published',current_version_id=p_version_id,published_at=coalesce(published_at,now()),updated_at=now()
 where id=p_product_id and status='verified';
 if not found then raise exception 'product_not_verified_or_not_ready'; end if;
 return jsonb_build_object('product_id',p_product_id,'version_id',p_version_id,'status','published');
end $$;
revoke all on function public.marketplace_publish_product(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_publish_product(uuid,uuid) to service_role;
