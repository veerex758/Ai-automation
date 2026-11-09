begin;
create or replace function public.marketplace_issue_enterprise_license(p_product_id uuid,p_version_id uuid,p_workspace_id uuid,p_type text,p_seats integer,p_expires_at timestamptz,p_actor_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_products%rowtype;v public.marketplace_product_versions%rowtype;l public.marketplace_licenses%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'license_issue_service_role_required';end if;
 if p_type not in ('seat','site','enterprise') or length(trim(p_note)) not between 10 and 1000 or p_expires_at is not null and p_expires_at<=now() then raise exception 'invalid_license_issue';end if;
 if p_type='seat' and (p_seats is null or p_seats<1 or p_seats>100000) then raise exception 'invalid_license_seats';end if;
 if p_type<>'seat' and p_seats is not null then raise exception 'seats_not_applicable';end if;
 select * into p from public.marketplace_products where id=p_product_id and status='published' for share;select * into v from public.marketplace_product_versions where id=p_version_id and product_id=p_product_id and verification_status='approved' for share;
 if p.id is null or v.id is null or p.current_version_id<>v.id then raise exception 'license_product_version_unverified';end if;
 if not exists(select 1 from public.workspaces where id=p_workspace_id) then raise exception 'license_workspace_not_found';end if;
 insert into public.marketplace_licenses(product_id,product_version_id,buyer_workspace_id,license_type,seats,status,starts_at,expires_at,created_by) values(p.id,v.id,p_workspace_id,p_type,p_seats,'active',now(),p_expires_at,p_actor_id) returning * into l;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details) values(p_actor_id,'enterprise_license_issued','license',l.id,jsonb_build_object('workspace_id',p_workspace_id,'product_id',p.id,'version_id',v.id,'type',p_type,'seats',p_seats,'expires_at',p_expires_at,'note',trim(p_note)));
 return jsonb_build_object('license_id',l.id,'status',l.status,'type',l.license_type,'seats',l.seats,'expires_at',l.expires_at);
end; $$;
revoke all on function public.marketplace_issue_enterprise_license(uuid,uuid,uuid,text,integer,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_issue_enterprise_license(uuid,uuid,uuid,text,integer,timestamptz,uuid,text) to service_role;
commit;
