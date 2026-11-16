-- Keep a live customer's current workflow active while an update/rollback candidate is tested.
create table if not exists public.marketplace_installation_staged_versions(
 installation_id uuid primary key references public.marketplace_installations(id) on delete cascade,
 product_version_id uuid not null references public.marketplace_product_versions(id) on delete restrict,
 workflow_id uuid not null unique references public.workflows(id) on delete cascade,
 configuration jsonb not null default '{}'::jsonb check(jsonb_typeof(configuration)='object'),
 artifact_sha256 char(64) not null check(artifact_sha256 ~ '^[a-f0-9]{64}$'),
 transition_action text not null check(transition_action in ('update','rollback')),
 previous_status text not null check(previous_status in ('active','paused','ready','configuring')),
 status text not null default 'configuring' check(status in ('configuring','ready')),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now()
);
alter table public.marketplace_installation_staged_versions enable row level security;
revoke all on public.marketplace_installation_staged_versions from public,anon,authenticated;
grant select,insert,update,delete on public.marketplace_installation_staged_versions to service_role;

create or replace function public.marketplace_transition_installation_version(
 p_installation_id uuid,p_actor_id uuid,p_action text,p_target_version_id uuid,p_artifact_sha256 text
) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.marketplace_installations; p public.marketplace_products;
 old_version public.marketplace_product_versions; target public.marketplace_product_versions;
 creator_status text; new_workflow_id uuid;
 keep_configuration boolean:=false; next_configuration jsonb:='{}'::jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_actor_id is null or p_action not in ('update','rollback') or p_target_version_id is null then raise exception 'invalid_installation_version_transition'; end if;
 select * into i from public.marketplace_installations where id=p_installation_id for update;
 if not found or i.installed_by<>p_actor_id then raise exception 'installation_owner_required'; end if;
 if i.status not in ('configuring','ready','paused','active') then raise exception 'installation_state_cannot_stage_version'; end if;
 if not exists(select 1 from public.workspaces w where w.id=i.workspace_id and w.owner_id=p_actor_id)
  and not exists(select 1 from public.workspace_members wm where wm.workspace_id=i.workspace_id and wm.user_id=p_actor_id) then
  raise exception 'workspace_access_denied';
 end if;
 select * into p from public.marketplace_products where id=i.product_id for share;
 if not found or p.status<>'published' then raise exception 'product_not_available_for_version_transition'; end if;
 if p.creator_id is not null then
  select status into creator_status from public.marketplace_creators where id=p.creator_id for share;
  if creator_status is distinct from 'verified' then raise exception 'creator_not_verified'; end if;
 end if;
 if p.pricing_type='free' then
  if not exists(select 1 from public.marketplace_entitlements e where e.user_id=p_actor_id and e.product_id=p.id and e.status='active' and e.entitlement_type in ('free','admin_grant')) then raise exception 'active_entitlement_required'; end if;
 elsif not exists(select 1 from public.marketplace_entitlements e where e.user_id=p_actor_id and e.product_id=p.id and e.status='active' and e.entitlement_type in ('purchase','subscription','admin_grant') and (e.ends_at is null or e.ends_at>now())) then
  raise exception 'active_entitlement_required';
 end if;
 select * into old_version from public.marketplace_product_versions where id=i.product_version_id and product_id=i.product_id;
 if not found then raise exception 'installed_version_missing'; end if;
 select * into target from public.marketplace_product_versions where id=p_target_version_id and product_id=i.product_id and verification_status='approved' for share;
 if not found then raise exception 'target_version_not_approved'; end if;
 if p_artifact_sha256 is null or lower(p_artifact_sha256)<>target.artifact_sha256 then raise exception 'artifact_hash_mismatch'; end if;
 if jsonb_typeof(target.manifest->'definition') is distinct from 'object' then raise exception 'workflow_definition_missing'; end if;
 if target.id=i.product_version_id then raise exception 'target_version_already_installed'; end if;
 if p_action='update' and target.id is distinct from p.current_version_id then raise exception 'update_target_not_current_verified_version'; end if;
 if p_action='rollback' and not exists(select 1 from public.marketplace_installation_history h where h.installation_id=i.id and h.product_version_id=target.id) then raise exception 'rollback_target_not_in_installation_history'; end if;
 if p_action='rollback' and target.verification_status<>'approved' then raise exception 'rollback_target_revoked_or_unverified'; end if;
 keep_configuration:=coalesce(old_version.manifest->'integrations','null'::jsonb)=coalesce(target.manifest->'integrations','null'::jsonb)
  and coalesce(old_version.manifest->'permissions','null'::jsonb)=coalesce(target.manifest->'permissions','null'::jsonb);
 if keep_configuration then next_configuration:=i.configuration; end if;
 if i.workflow_id is not null and not exists(select 1 from public.workflows where id=i.workflow_id and workspace_id=i.workspace_id) then raise exception 'installed_workflow_missing'; end if;
 insert into public.workflows(workspace_id,name,description,definition,status,created_by)
 values(i.workspace_id,left(p.name,80),left('Marketplace '||p_action||' from version '||target.version,500),target.manifest->'definition','draft',p_actor_id)
 returning id into new_workflow_id;
 insert into public.marketplace_installation_staged_versions(installation_id,product_version_id,workflow_id,configuration,artifact_sha256,transition_action,previous_status,created_by)
 values(i.id,target.id,new_workflow_id,next_configuration,target.artifact_sha256,p_action,i.status,p_actor_id)
 on conflict(installation_id) do update set product_version_id=excluded.product_version_id,workflow_id=excluded.workflow_id,
  configuration=excluded.configuration,artifact_sha256=excluded.artifact_sha256,transition_action=excluded.transition_action,
  previous_status=excluded.previous_status,created_by=excluded.created_by,created_at=now(),status='configuring';
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(p_actor_id,'installation_version_'||p_action,'installation',i.id,jsonb_build_object(
  'from_version_id',i.product_version_id,'to_version_id',target.id,'from_workflow_id',i.workflow_id,
  'to_workflow_id',new_workflow_id,'configuration_preserved',keep_configuration,'artifact_sha256',target.artifact_sha256));
 return jsonb_build_object('installation_id',i.id,'status','staged','action',p_action,
  'product_version_id',target.id,'workflow_id',new_workflow_id,'configuration_preserved',keep_configuration,
  'previous_workflow_id',i.workflow_id,'artifact_sha256',target.artifact_sha256);
end $$;

revoke all on function public.marketplace_transition_installation_version(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_transition_installation_version(uuid,uuid,text,uuid,text) to service_role;

create or replace function public.marketplace_mark_staged_installation_ready(p_installation_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.marketplace_installation_staged_versions;i public.marketplace_installations;p public.marketplace_products;v public.marketplace_product_versions;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required';end if;
 select * into i from public.marketplace_installations where id=p_installation_id for update;
 if not found or i.installed_by<>p_actor_id then raise exception 'installation_owner_required';end if;
 select * into s from public.marketplace_installation_staged_versions where installation_id=i.id for update;
 if not found then raise exception 'staged_version_missing';end if;
 select * into p from public.marketplace_products where id=i.product_id;
 select * into v from public.marketplace_product_versions where id=s.product_version_id and product_id=i.product_id;
 if p.status<>'published' or v.verification_status<>'approved' then raise exception 'staged_version_no_longer_approved';end if;
 update public.marketplace_installation_staged_versions set status='ready' where installation_id=i.id;
 return jsonb_build_object('installation_id',i.id,'staged_workflow_id',s.workflow_id,'status','ready','active_workflow_unchanged',i.workflow_id);
end $$;
revoke all on function public.marketplace_mark_staged_installation_ready(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_mark_staged_installation_ready(uuid,uuid) to service_role;

create or replace function public.marketplace_commit_installation_staged_version(p_installation_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.marketplace_installations;s public.marketplace_installation_staged_versions;p public.marketplace_products;v public.marketplace_product_versions;oldv public.marketplace_product_versions;result_status text;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required';end if;
 select * into i from public.marketplace_installations where id=p_installation_id for update;
 if not found or i.installed_by<>p_actor_id then raise exception 'installation_owner_required';end if;
 select * into s from public.marketplace_installation_staged_versions where installation_id=i.id for update;
 if not found or s.status<>'ready' then raise exception 'successful_staged_dry_run_required';end if;
 select * into p from public.marketplace_products where id=i.product_id for share;
 select * into v from public.marketplace_product_versions where id=s.product_version_id and product_id=i.product_id and verification_status='approved' for share;
 if p.status<>'published' or not found then raise exception 'staged_version_no_longer_approved';end if;
 select * into oldv from public.marketplace_product_versions where id=i.product_version_id and product_id=i.product_id;
 insert into public.marketplace_installation_history(installation_id,product_version_id,workflow_id,configuration,artifact_sha256,transition_action,changed_by)
 values(i.id,i.product_version_id,i.workflow_id,i.configuration,oldv.artifact_sha256,s.transition_action,p_actor_id);
 result_status:=case when s.previous_status='active' then 'active' else 'ready' end;
 if i.workflow_id is not null then
  update public.workflows set status='archived',updated_at=now() where id=i.workflow_id and workspace_id=i.workspace_id;
  update public.workflow_schedules set enabled=false where workflow_id=i.workflow_id;
  update public.webhook_endpoints set status='revoked' where workflow_id=i.workflow_id;
 end if;
 update public.workflows set status=case when result_status='active' then 'active' else 'draft' end,updated_at=now()
 where id=s.workflow_id and workspace_id=i.workspace_id;
 update public.marketplace_installations set product_version_id=s.product_version_id,workflow_id=s.workflow_id,configuration=s.configuration,
  status=result_status,activated_at=case when result_status='active' then now() else null end where id=i.id;
 delete from public.marketplace_installation_staged_versions where installation_id=i.id;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(p_actor_id,'installation_version_committed','installation',i.id,jsonb_build_object('from_version_id',i.product_version_id,'to_version_id',s.product_version_id,'from_workflow_id',i.workflow_id,'to_workflow_id',s.workflow_id,'status',result_status,'transition_action',s.transition_action));
 return jsonb_build_object('installation_id',i.id,'product_version_id',s.product_version_id,'workflow_id',s.workflow_id,'status',result_status,'previous_workflow_id',i.workflow_id);
end $$;
revoke all on function public.marketplace_commit_installation_staged_version(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_commit_installation_staged_version(uuid,uuid) to service_role;
