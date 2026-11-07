-- Materialize a verified Marketplace artifact as a workspace-owned draft workflow.
create unique index if not exists marketplace_entitlements_one_free_per_user_product
 on public.marketplace_entitlements(user_id,product_id)
 where entitlement_type='free' and purchase_id is null;

-- Re-installing the same version is idempotent; installing a newer version creates
-- a new draft copy and leaves the customer's previous workflow untouched.

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
   return jsonb_build_object(
    'installation_id',existing.id,'workspace_id',existing.workspace_id,
    'product_id',existing.product_id,'product_version_id',existing.product_version_id,
    'workflow_id',existing.workflow_id,'status',existing.status,
    'update_available',true,'latest_version_id',v.id,'created_at',existing.installed_at
   );
  else result:=existing;
  end if;
 else
  insert into public.marketplace_installations(workspace_id,product_id,product_version_id,installed_by,status,configuration)
  values(p_workspace_id,p.id,v.id,u,'configuring','{}'::jsonb) returning * into result;
 end if;
 return jsonb_build_object('installation_id',result.id,'workspace_id',result.workspace_id,'product_id',result.product_id,'product_version_id',result.product_version_id,'workflow_id',result.workflow_id,'status',result.status,'created_at',result.installed_at);
end $$;
revoke all on function public.marketplace_install_product(uuid,uuid) from public,anon;
grant execute on function public.marketplace_install_product(uuid,uuid) to authenticated;

create or replace function public.marketplace_materialize_installation(
 p_installation_id uuid,p_actor_id uuid,p_artifact_sha256 text
) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.marketplace_installations; p public.marketplace_products; v public.marketplace_product_versions; creator_status text; existing_workflow_id uuid; new_workflow_id uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_actor_id is null or not exists(select 1 from auth.users where id=p_actor_id) then
  raise exception 'valid_installing_user_required';
 end if;
 select * into i from public.marketplace_installations where id=p_installation_id for update;
 if not found or i.installed_by<>p_actor_id then raise exception 'installation_not_found_or_not_owned'; end if;
 select * into p from public.marketplace_products where id=i.product_id for share;
 if not found or p.status<>'published' or p.current_version_id<>i.product_version_id then
  raise exception 'product_version_no_longer_installable';
 end if;
 if p.creator_id is not null then
  select status into creator_status from public.marketplace_creators where id=p.creator_id for share;
  if creator_status is distinct from 'verified' then raise exception 'creator_not_verified'; end if;
 end if;
 select * into v from public.marketplace_product_versions
 where id=i.product_version_id and product_id=i.product_id and verification_status='approved' for share;
 if not found or p_artifact_sha256 is null or lower(p_artifact_sha256)<>v.artifact_sha256 then
  raise exception 'artifact_hash_mismatch';
 end if;
 if jsonb_typeof(v.manifest->'definition') is distinct from 'object' then
  raise exception 'workflow_definition_missing';
 end if;
 if i.workflow_id is not null then
  select id into existing_workflow_id from public.workflows
  where id=i.workflow_id and workspace_id=i.workspace_id;
  if found then
   return jsonb_build_object('installation_id',i.id,'workflow_id',existing_workflow_id,'product_version_id',i.product_version_id,'status',i.status,'created',false);
  end if;
  update public.marketplace_installations set workflow_id=null where id=i.id;
 end if;
 insert into public.workflows(workspace_id,name,description,definition,status,created_by)
 values(
  i.workspace_id,
  left(p.name,80),
  left('Installed from Aivanta Marketplace: '||p.name,500),
  v.manifest->'definition',
  'draft',
  p_actor_id
 ) returning id into new_workflow_id;
 update public.marketplace_installations set workflow_id=new_workflow_id where id=i.id;
 return jsonb_build_object('installation_id',i.id,'workflow_id',new_workflow_id,'product_version_id',i.product_version_id,'status','configuring','created',true);
end $$;
revoke all on function public.marketplace_materialize_installation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_materialize_installation(uuid,uuid,text) to service_role;
