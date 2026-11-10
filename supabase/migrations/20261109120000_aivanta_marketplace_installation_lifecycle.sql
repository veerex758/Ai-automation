-- Phase A installation lifecycle: configure -> dry-run ready -> activation, pause and uninstall.
create or replace function public.marketplace_installation_lifecycle(p_installation_id uuid,p_actor_id uuid,p_action text,p_configuration jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.marketplace_installations; p public.marketplace_products; w public.workflows; result public.marketplace_installations;
begin
 if p_actor_id is null or p_action not in ('configure','mark_ready','activate','pause','uninstall') then raise exception 'invalid_installation_transition'; end if;
 select * into i from public.marketplace_installations where id=p_installation_id for update;
 if not found or i.installed_by<>p_actor_id then raise exception 'installation_owner_required'; end if;
 if i.workflow_id is null then raise exception 'installation_workflow_missing'; end if;
 select * into p from public.marketplace_products where id=i.product_id for share;
 select * into w from public.workflows where id=i.workflow_id and workspace_id=i.workspace_id for update;
 if not found then raise exception 'installation_workflow_missing'; end if;
 if p_action='configure' then
  if i.status not in ('configuring','ready') then raise exception 'installation_not_configurable'; end if;
  if p_configuration is null or jsonb_typeof(p_configuration)<>'object' then raise exception 'invalid_installation_configuration'; end if;
  update public.marketplace_installations set configuration=p_configuration,status='configuring',activated_at=null where id=i.id returning * into result;
 elsif p_action='mark_ready' then
  if i.status<>'configuring' then raise exception 'installation_not_configuring'; end if;
  if p.status<>'published' or p.current_version_id<>i.product_version_id then raise exception 'product_version_no_longer_current'; end if;
  if not exists(select 1 from public.marketplace_product_versions v where v.id=i.product_version_id and v.product_id=i.product_id and v.verification_status='approved') then raise exception 'verified_version_required'; end if;
  update public.marketplace_installations set status='ready' where id=i.id returning * into result;
 elsif p_action='activate' then
  if i.status<>'ready' then raise exception 'successful_dry_run_required'; end if;
  if p.status<>'published' or p.current_version_id<>i.product_version_id then raise exception 'product_version_no_longer_current'; end if;
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
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details) values(p_actor_id,'installation_'||p_action,'installation',i.id,jsonb_build_object('product_id',i.product_id,'workflow_id',i.workflow_id,'status',result.status));
 return jsonb_build_object('installation_id',result.id,'status',result.status,'workflow_id',result.workflow_id,'product_version_id',result.product_version_id);
end $$;
revoke all on function public.marketplace_installation_lifecycle(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketplace_installation_lifecycle(uuid,uuid,text,jsonb) to service_role;
