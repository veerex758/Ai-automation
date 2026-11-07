-- A suspended or pending creator must not keep public listings or install access.
-- Creator moderation and its audit entry are committed atomically.
drop policy if exists marketplace_products_public_read on public.marketplace_products;
create policy marketplace_products_public_read
 on public.marketplace_products for select to anon,authenticated
 using (
  status='published'
  and current_version_id is not null
  and exists (
   select 1 from public.marketplace_product_versions v
   where v.id=current_version_id
     and v.product_id=id
     and v.verification_status='approved'
  )
  and (
   creator_id is null
   or exists (
    select 1 from public.marketplace_creators c
    where c.id=creator_id and c.status='verified'
   )
  )
 );

create or replace function public.marketplace_install_product(p_product_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.marketplace_products; v public.marketplace_product_versions; u uuid; existing public.marketplace_installations; result public.marketplace_installations;
begin
 u:=auth.uid();
 if u is null then raise exception 'authentication_required'; end if;
 if not private.is_workspace_member(p_workspace_id) then raise exception 'workspace_access_denied'; end if;
 select * into p from public.marketplace_products where id=p_product_id for update;
 if not found or p.status<>'published' then raise exception 'product_not_available'; end if;
 if p.creator_id is not null and not exists(
  select 1 from public.marketplace_creators c where c.id=p.creator_id and c.status='verified'
 ) then raise exception 'product_not_available'; end if;
 select * into v from public.marketplace_product_versions
 where id=p.current_version_id and product_id=p.id and verification_status='approved' for share;
 if not found then raise exception 'verified_version_required'; end if;
 if p.pricing_type='free' then
  if not exists(select 1 from public.marketplace_entitlements e where e.user_id=u and e.product_id=p.id and e.status='active' and e.entitlement_type in ('free','admin_grant')) then
   insert into public.marketplace_entitlements(user_id,product_id,entitlement_type,status)
   values(u,p.id,'free','active') on conflict do nothing;
  end if;
 elsif not exists(select 1 from public.marketplace_entitlements e where e.user_id=u and e.product_id=p.id and e.status='active' and e.entitlement_type in ('purchase','subscription','admin_grant') and (e.ends_at is null or e.ends_at>now())) then
  raise exception 'active_entitlement_required';
 end if;
 select * into existing from public.marketplace_installations
 where workspace_id=p_workspace_id and product_id=p.id and status<>'removed' for update;
 if found then
  if existing.product_version_id<>v.id then
   update public.marketplace_installations set product_version_id=v.id,status='configuring',activated_at=null
   where id=existing.id returning * into result;
  else result:=existing;
  end if;
 else
  insert into public.marketplace_installations(workspace_id,product_id,product_version_id,installed_by,status,configuration)
  values(p_workspace_id,p.id,v.id,u,'configuring','{}'::jsonb) returning * into result;
 end if;
 return jsonb_build_object('installation_id',result.id,'workspace_id',result.workspace_id,'product_id',result.product_id,'product_version_id',result.product_version_id,'status',result.status,'created_at',result.installed_at);
end $$;
revoke all on function public.marketplace_install_product(uuid,uuid) from public,anon;
grant execute on function public.marketplace_install_product(uuid,uuid) to authenticated;

create or replace function public.marketplace_moderate_creator(
 p_creator_id uuid,p_actor_id uuid,p_action text,p_notes text default ''
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.marketplace_creators; next_status text;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id) then
  raise exception 'valid_reviewer_required';
 end if;
 if p_action not in ('verify','suspend','reinstate') then raise exception 'invalid_creator_action'; end if;
 select * into c from public.marketplace_creators where id=p_creator_id for update;
 if not found then raise exception 'creator_not_found'; end if;
 next_status:=case p_action when 'verify' then 'verified' when 'suspend' then 'suspended' else 'pending' end;
 if p_action='reinstate' and c.status<>'suspended' then raise exception 'creator_not_suspended'; end if;
 if p_action='verify' and c.status='suspended' then raise exception 'suspended_creator_cannot_be_verified'; end if;
 update public.marketplace_creators
 set status=next_status,updated_at=now()
 where id=p_creator_id;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(
  p_actor_id,'creator_'||p_action,'creator',p_creator_id,
  jsonb_build_object('from',c.status,'to',next_status,'notes',left(coalesce(p_notes,''),1000))
 );
 return jsonb_build_object('id',p_creator_id,'status',next_status,'previous_status',c.status);
end $$;
revoke all on function public.marketplace_moderate_creator(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_moderate_creator(uuid,uuid,text,text) to service_role;
