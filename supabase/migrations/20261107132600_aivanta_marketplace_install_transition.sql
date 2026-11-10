-- Authenticated, entitlement-aware Marketplace install transition.
-- Installation starts in configuring state; it never activates or executes the artifact.
create unique index if not exists marketplace_installations_one_live_product_per_workspace
 on public.marketplace_installations(workspace_id,product_id) where status <> 'removed';

create or replace function public.marketplace_install_product(p_product_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.marketplace_products; v public.marketplace_product_versions; u uuid; existing public.marketplace_installations; result public.marketplace_installations;
begin
 u:=auth.uid();
 if u is null then raise exception 'authentication_required'; end if;
 if not private.is_workspace_member(p_workspace_id) then raise exception 'workspace_access_denied'; end if;
 select * into p from public.marketplace_products where id=p_product_id for update;
 if not found or p.status<>'published' then raise exception 'product_not_available'; end if;
 select * into v from public.marketplace_product_versions where id=p.current_version_id and product_id=p.id and verification_status='approved' for share;
 if not found then raise exception 'verified_version_required'; end if;
 if p.pricing_type='free' then
  if not exists(select 1 from public.marketplace_entitlements e where e.user_id=u and e.product_id=p.id and e.status='active' and e.entitlement_type in ('free','admin_grant')) then
   insert into public.marketplace_entitlements(user_id,product_id,entitlement_type,status)
   values(u,p.id,'free','active') on conflict do nothing;
  end if;
 elsif not exists(select 1 from public.marketplace_entitlements e where e.user_id=u and e.product_id=p.id and e.status='active' and e.entitlement_type in ('purchase','subscription','admin_grant') and (e.ends_at is null or e.ends_at>now())) then
  raise exception 'active_entitlement_required';
 end if;
 select * into existing from public.marketplace_installations where workspace_id=p_workspace_id and product_id=p.id and status<>'removed' for update;
 if found then
  if existing.product_version_id<>v.id then
   update public.marketplace_installations set product_version_id=v.id,status='configuring',activated_at=null where id=existing.id returning * into result;
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
