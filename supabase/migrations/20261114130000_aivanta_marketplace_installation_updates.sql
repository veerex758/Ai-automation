-- Marketplace Priority 2: versioned installation updates, rollback, connection mapping and runtime revocation.
create table if not exists public.marketplace_installation_history (
 id uuid primary key default gen_random_uuid(),
 installation_id uuid not null references public.marketplace_installations(id) on delete cascade,
 product_version_id uuid not null references public.marketplace_product_versions(id) on delete restrict,
 workflow_id uuid references public.workflows(id) on delete set null,
 configuration jsonb not null default '{}'::jsonb check(jsonb_typeof(configuration)='object'),
 artifact_sha256 char(64) not null check(artifact_sha256 ~ '^[a-f0-9]{64}$'),
 transition_action text not null check(transition_action in ('initial','update','rollback')),
 changed_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now()
);
create index if not exists marketplace_installation_history_lookup_idx
 on public.marketplace_installation_history(installation_id,created_at desc);
create index if not exists marketplace_installation_history_workflow_idx
 on public.marketplace_installation_history(workflow_id) where workflow_id is not null;
alter table public.marketplace_installation_history enable row level security;
revoke all on public.marketplace_installation_history from public,anon,authenticated;
grant select,insert on public.marketplace_installation_history to service_role;

-- Update/rollback always materialize a fresh draft. Prior customer workflows remain archived
-- and their immutable version/configuration snapshots remain available for rollback.
create or replace function public.marketplace_transition_installation_version(
 p_installation_id uuid,p_actor_id uuid,p_action text,p_target_version_id uuid,p_artifact_sha256 text
) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.marketplace_installations; p public.marketplace_products;
 old_version public.marketplace_product_versions; target public.marketplace_product_versions;
 creator_status text; new_workflow_id uuid; old_workflow_status text;
 keep_configuration boolean:=false; next_configuration jsonb:='{}'::jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 if p_actor_id is null or p_action not in ('update','rollback') or p_target_version_id is null then raise exception 'invalid_installation_version_transition'; end if;
 select * into i from public.marketplace_installations where id=p_installation_id for update;
 if not found or i.installed_by<>p_actor_id then raise exception 'installation_owner_required'; end if;
 if i.status not in ('configuring','ready','paused') then raise exception 'pause_installation_before_version_transition'; end if;
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
 if i.workflow_id is not null then
  select status into old_workflow_status from public.workflows where id=i.workflow_id and workspace_id=i.workspace_id for update;
  if found then
   insert into public.marketplace_installation_history(installation_id,product_version_id,workflow_id,configuration,artifact_sha256,transition_action,changed_by)
   values(i.id,i.product_version_id,i.workflow_id,i.configuration,old_version.artifact_sha256,p_action,p_actor_id);
   update public.workflows set status='archived',updated_at=now() where id=i.workflow_id and workspace_id=i.workspace_id;
  else
   raise exception 'installed_workflow_missing';
  end if;
 else
  insert into public.marketplace_installation_history(installation_id,product_version_id,workflow_id,configuration,artifact_sha256,transition_action,changed_by)
  values(i.id,i.product_version_id,null,i.configuration,old_version.artifact_sha256,p_action,p_actor_id);
 end if;
 insert into public.workflows(workspace_id,name,description,definition,status,created_by)
 values(i.workspace_id,left(p.name,80),left('Marketplace '||p_action||' from version '||target.version,500),target.manifest->'definition','draft',p_actor_id)
 returning id into new_workflow_id;
 update public.marketplace_installations set product_version_id=target.id,workflow_id=new_workflow_id,
  configuration=next_configuration,status='configuring',activated_at=null where id=i.id;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(p_actor_id,'installation_version_'||p_action,'installation',i.id,jsonb_build_object(
  'from_version_id',i.product_version_id,'to_version_id',target.id,'from_workflow_id',i.workflow_id,
  'to_workflow_id',new_workflow_id,'configuration_preserved',keep_configuration,'artifact_sha256',target.artifact_sha256));
 return jsonb_build_object('installation_id',i.id,'status','configuring','action',p_action,
  'product_version_id',target.id,'workflow_id',new_workflow_id,'configuration_preserved',keep_configuration,
  'previous_workflow_id',i.workflow_id,'artifact_sha256',target.artifact_sha256);
end $$;
revoke all on function public.marketplace_transition_installation_version(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_transition_installation_version(uuid,uuid,text,uuid,text) to service_role;

-- Rollback may intentionally pin an older, still-approved version. Activation is based on the
-- installed immutable version's approval, not equality with the catalog's newest version.
create or replace function public.marketplace_installation_lifecycle(p_installation_id uuid,p_actor_id uuid,p_action text,p_configuration jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.marketplace_installations; p public.marketplace_products; v public.marketplace_product_versions; w public.workflows; result public.marketplace_installations;
begin
 if p_actor_id is null or p_action not in ('configure','mark_ready','activate','pause','uninstall') then raise exception 'invalid_installation_transition'; end if;
 select * into i from public.marketplace_installations where id=p_installation_id for update;
 if not found or i.installed_by<>p_actor_id then raise exception 'installation_owner_required'; end if;
 if i.workflow_id is null then raise exception 'installation_workflow_missing'; end if;
 select * into p from public.marketplace_products where id=i.product_id for share;
 select * into v from public.marketplace_product_versions where id=i.product_version_id and product_id=i.product_id for share;
 if not found then raise exception 'installed_version_missing'; end if;
 select * into w from public.workflows where id=i.workflow_id and workspace_id=i.workspace_id for update;
 if not found then raise exception 'installation_workflow_missing'; end if;
 if p_action='configure' then
  if i.status not in ('configuring','ready','paused') then raise exception 'installation_not_configurable'; end if;
  if p_configuration is null or jsonb_typeof(p_configuration)<>'object' then raise exception 'invalid_installation_configuration'; end if;
  update public.marketplace_installations set configuration=p_configuration,status='configuring',activated_at=null where id=i.id returning * into result;
 elsif p_action='mark_ready' then
  if i.status<>'configuring' then raise exception 'installation_not_configuring'; end if;
  if p.status<>'published' or v.verification_status<>'approved' then raise exception 'product_version_no_longer_current'; end if;
  update public.marketplace_installations set status='ready' where id=i.id returning * into result;
 elsif p_action='activate' then
  if i.status<>'ready' then raise exception 'successful_dry_run_required'; end if;
  if p.status<>'published' or v.verification_status<>'approved' then raise exception 'product_version_no_longer_current'; end if;
  if w.status not in ('draft','paused') then raise exception 'workflow_not_activatable'; end if;
  update public.workflows set status='active',updated_at=now() where id=w.id;
  update public.marketplace_installations set status='active',activated_at=now() where id=i.id returning * into result;
 elsif p_action='pause' then
  if i.status<>'active' then raise exception 'installation_not_active'; end if;
  update public.workflows set status='paused',updated_at=now() where id=w.id;
  update public.marketplace_installations set status='paused' where id=i.id returning * into result;
 else
  if i.status='removed' then raise exception 'installation_already_removed'; end if;
  update public.workflows set status='archived',updated_at=now() where id=w.id;
  update public.marketplace_installations set status='removed',removed_at=now(),activated_at=null where id=i.id returning * into result;
 end if;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(p_actor_id,'installation_'||p_action,'installation',i.id,jsonb_build_object('product_id',i.product_id,'workflow_id',i.workflow_id,'status',result.status,'product_version_id',i.product_version_id));
 return jsonb_build_object('installation_id',result.id,'status',result.status,'workflow_id',result.workflow_id,'product_version_id',result.product_version_id);
end $$;
revoke all on function public.marketplace_installation_lifecycle(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketplace_installation_lifecycle(uuid,uuid,text,jsonb) to service_role;

-- Central execution guard: check before a live job and before every live step.
-- A workflow in installation history is an obsolete version and can never execute.
create or replace function public.marketplace_assert_installation_runtime(p_workflow_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.marketplace_installations; p public.marketplace_products; v public.marketplace_product_versions;
begin
 select * into i from public.marketplace_installations where workflow_id=p_workflow_id limit 1;
 if found then
  if i.status<>'active' then return false; end if;
  select * into p from public.marketplace_products where id=i.product_id;
  if not found or p.status<>'published' then return false; end if;
  select * into v from public.marketplace_product_versions where id=i.product_version_id and product_id=i.product_id;
  return found and v.verification_status='approved';
 end if;
 if exists(select 1 from public.marketplace_installation_history where workflow_id=p_workflow_id) then return false; end if;
 return true;
end $$;
revoke all on function public.marketplace_assert_installation_runtime(uuid) from public,anon,authenticated;
grant execute on function public.marketplace_assert_installation_runtime(uuid) to service_role;

-- Emergency revocation of any pinned version pauses only its affected customer installations,
-- even when that version is no longer the catalog's current version.
create or replace function public.marketplace_emit_customer_trust_notices()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare notice_kind text; notice_title text; notice_body text; should_pause boolean:=false;
begin
 if tg_table_name='marketplace_products' then
  if new.status is distinct from old.status and new.status in ('suspended','revoked','archived') then
   should_pause:=true;
   notice_kind:=case when new.status='revoked' then 'verification_revoked' when new.status='suspended' then 'product_suspended' else 'product_removed' end;
   notice_title:=case when new.status='revoked' then 'Marketplace verification revoked' when new.status='suspended' then 'Marketplace product suspended' else 'Marketplace product removed' end;
   notice_body:='This product was '||new.status||' by marketplace moderation. Existing installations have been paused; do not resume until Aivanta resolves the notice.';
  elsif new.current_version_id is distinct from old.current_version_id then
   notice_kind:='update_available';notice_title:='Verified product update available';notice_body:='A new verified version is available. Review its changelog and permissions before updating.';
  elsif new.permissions is distinct from old.permissions or new.integrations is distinct from old.integrations then
   notice_kind:='permission_change';notice_title:='Marketplace permissions or integrations changed';notice_body:='The product permissions or required integrations changed. Review the listing before updating or activating.';
  else return new;
  end if;
  if should_pause then
   update public.workflows w set status='paused',updated_at=now() from public.marketplace_installations i where i.product_id=new.id and i.workflow_id=w.id and i.status='active';
   update public.marketplace_installations set status='paused' where product_id=new.id and status='active';
  end if;
  insert into public.marketplace_customer_notices(user_id,product_id,installation_id,notice_type,title,body)
  select distinct i.installed_by,new.id,i.id,notice_kind,notice_title,notice_body from public.marketplace_installations i where i.product_id=new.id and i.status<>'removed';
  return new;
 else
  if old.verification_status='approved' and new.verification_status='revoked' then
   update public.workflows w set status='paused',updated_at=now() from public.marketplace_installations i
    where i.product_version_id=new.id and i.workflow_id=w.id and i.status='active';
   update public.marketplace_installations set status='paused' where product_version_id=new.id and status='active';
   insert into public.marketplace_customer_notices(user_id,product_id,installation_id,notice_type,title,body)
   select distinct i.installed_by,new.product_id,i.id,'verification_revoked','Marketplace version revoked',
    'The exact version installed in this workspace was revoked. Its workflow has been paused and cannot execute until a verified version is installed.'
   from public.marketplace_installations i where i.product_version_id=new.id and i.status<>'removed';
   if exists(select 1 from public.marketplace_products p where p.id=new.product_id and p.current_version_id=new.id and p.status in ('published','verified')) then
    update public.marketplace_products set status='revoked',updated_at=now() where id=new.product_id;
   end if;
  end if;
  return new;
 end if;
end $$;
drop trigger if exists marketplace_product_customer_trust_notice on public.marketplace_products;
create trigger marketplace_product_customer_trust_notice after update of status,current_version_id,permissions,integrations on public.marketplace_products for each row execute function public.marketplace_emit_customer_trust_notices();
drop trigger if exists marketplace_version_revocation_notice on public.marketplace_product_versions;
create trigger marketplace_version_revocation_notice after update of verification_status on public.marketplace_product_versions for each row execute function public.marketplace_emit_customer_trust_notices();
revoke all on function public.marketplace_emit_customer_trust_notices() from public,anon,authenticated;
