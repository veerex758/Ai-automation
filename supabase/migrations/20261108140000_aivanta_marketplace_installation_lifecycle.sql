begin;
create table if not exists public.marketplace_installation_history(
 id uuid primary key default gen_random_uuid(),installation_id uuid not null references public.marketplace_installations(id) on delete cascade,
 product_version_id uuid not null references public.marketplace_product_versions(id) on delete restrict,
 workflow_id uuid references public.workflows(id) on delete set null,workflow_definition jsonb not null,
 captured_at timestamptz not null default now(),captured_by uuid not null references auth.users(id) on delete restrict
);
create index if not exists marketplace_installation_history_latest_idx on public.marketplace_installation_history(installation_id,captured_at desc);
create table if not exists public.marketplace_installation_events(
 id uuid primary key default gen_random_uuid(),installation_id uuid not null references public.marketplace_installations(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,event_type text not null,from_status text,to_status text,details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
alter table public.marketplace_installation_history enable row level security;alter table public.marketplace_installation_events enable row level security;
revoke all on public.marketplace_installation_history,public.marketplace_installation_events from anon,authenticated;
grant all on public.marketplace_installation_history,public.marketplace_installation_events to service_role;
create or replace function public.marketplace_transition_installation(p_installation_id uuid,p_actor_id uuid,p_action text,p_dry_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.marketplace_installations%rowtype;prior public.marketplace_installation_history%rowtype;target text;old text;
begin
 if auth.role()<>'service_role' then raise exception 'installation_transition_service_role_required';end if;
 select * into i from public.marketplace_installations where id=p_installation_id for update;if not found then raise exception 'installation_not_found';end if;
 if i.installed_by<>p_actor_id and not private.is_workspace_member(i.workspace_id) then raise exception 'installation_workspace_access_denied';end if;
 old:=i.status;
 if p_action='dry_run_passed' then
  if i.workflow_id is null or p_dry_run_id is null or not exists(select 1 from public.workflow_runs r where r.id=p_dry_run_id and r.workflow_id=i.workflow_id and r.workspace_id=i.workspace_id and r.mode='dry_run' and r.status='succeeded' and r.created_by=p_actor_id) then raise exception 'successful_dry_run_required';end if;
  target:='ready';
 elsif p_action='activate' then if i.status<>'ready' then raise exception 'installation_dry_run_required';end if;target:='active';
 elsif p_action='pause' then if i.status<>'active' then raise exception 'installation_not_active';end if;target:='paused';
 elsif p_action='uninstall' then if i.status='removed' then return jsonb_build_object('status','removed','duplicate',true);end if;target:='removed';
 elsif p_action='rollback' then select * into prior from public.marketplace_installation_history where installation_id=i.id order by captured_at desc limit 1 for update;if not found then raise exception 'installation_rollback_unavailable';end if;update public.marketplace_installations set product_version_id=prior.product_version_id,workflow_id=prior.workflow_id,status='paused',activated_at=null,removed_at=null where id=i.id;target:='paused';
 else raise exception 'invalid_installation_action';end if;
 update public.marketplace_installations set status=target,activated_at=case when target='active' then now() when target in ('paused','removed','ready','configuring') then null else activated_at end,removed_at=case when target='removed' then now() else null end where id=i.id;
 insert into public.marketplace_installation_events(installation_id,actor_id,event_type,from_status,to_status,details) values(i.id,p_actor_id,p_action,old,target,jsonb_build_object('dry_run_id',p_dry_run_id));
 return jsonb_build_object('installation_id',i.id,'status',target,'previous_status',old);
end $$;
revoke all on function public.marketplace_transition_installation(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_transition_installation(uuid,uuid,text,uuid) to service_role;
commit;
