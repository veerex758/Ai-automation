-- Bring a clean migration replay into parity with the verified isolated staging catalog.
-- Adds the current least-privilege policies and normalizes function bodies/defaults
-- that were previously created directly on staging. This is additive to source history;
-- it does not modify the remote database by itself.

alter table public.workflows alter column status set default 'draft'::character varying;

create or replace function private.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner','admin')
  );
$$;
revoke all on function private.is_workspace_admin(uuid) from public, anon;
grant execute on function private.is_workspace_admin(uuid) to authenticated;

-- Restore the canonical current policy names after the foundation's legacy policies
-- have been removed by 20261013007000.
create policy audit_events_select_member
  on public.audit_events for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy workflow_versions_select_member
  on public.workflow_versions for select to authenticated
  using (exists (
    select 1 from public.workflows w
    where w.id = workflow_versions.workflow_id
      and private.is_workspace_member(w.workspace_id)
  ));

create policy workflows_delete_admin
  on public.workflows for delete to authenticated
  using (private.is_workspace_admin(workspace_id));

create policy workflows_insert_member
  on public.workflows for insert to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and created_by = (select auth.uid())
  );

create policy workflows_select_member
  on public.workflows for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy workflows_update_member
  on public.workflows for update to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

create policy workspace_members_delete_admin
  on public.workspace_members for delete to authenticated
  using (
    private.is_workspace_admin(workspace_id)
    and user_id <> (select auth.uid())
  );

create policy workspace_members_insert_admin_or_owner_setup
  on public.workspace_members for insert to authenticated
  with check (
    private.is_workspace_admin(workspace_id)
    or (
      user_id = (select auth.uid())
      and role = 'owner'
      and exists (
        select 1 from public.workspaces w
        where w.id = workspace_members.workspace_id
          and w.owner_id = (select auth.uid())
      )
    )
  );

create policy workspace_members_select_self_or_admin
  on public.workspace_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_workspace_admin(workspace_id)
  );

create policy workspace_members_update_admin
  on public.workspace_members for update to authenticated
  using (private.is_workspace_admin(workspace_id))
  with check (private.is_workspace_admin(workspace_id));

create policy workspaces_insert_owner
  on public.workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy workspaces_select_member
  on public.workspaces for select to authenticated
  using (
    private.is_workspace_member(id)
    or owner_id = (select auth.uid())
  );

-- Keep the staging function bodies byte-for-byte aligned with the live catalog so
-- schema diff doesn't report cosmetic/function-definition drift on every run.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.save_workflow_definition(
  p_workflow_id uuid,
  p_definition jsonb
)
returns table (saved_workflow_id uuid, saved_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_workspace_id uuid;
  previous_definition_flag text;
  previous_history_flag text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select wf.workspace_id into target_workspace_id from public.workflows as wf where wf.id = p_workflow_id;
  if not found or not private.is_workspace_member(target_workspace_id) then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;
  previous_definition_flag := pg_catalog.current_setting('aivanta.allow_workflow_definition_write', true);
  previous_history_flag := pg_catalog.current_setting('aivanta.allow_history_audit_write', true);
  perform pg_catalog.set_config('aivanta.allow_workflow_definition_write', 'on', true);
  perform pg_catalog.set_config('aivanta.allow_history_audit_write', 'on', true);
  return query select saved.saved_workflow_id, saved.saved_version
    from private.save_workflow_definition_legacy(p_workflow_id,p_definition) as saved;
  perform pg_catalog.set_config('aivanta.allow_workflow_definition_write', coalesce(previous_definition_flag, ''), true);
  perform pg_catalog.set_config('aivanta.allow_history_audit_write', coalesce(previous_history_flag, ''), true);
end;
$$;

create or replace function public.record_workflow_dry_run(
  p_workflow_id uuid,
  p_expected_version integer,
  p_status text,
  p_duration_ms integer,
  p_error_message text,
  p_steps jsonb
)
returns table (run_id uuid, workflow_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_workspace_id uuid;
  previous_history_flag text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select wf.workspace_id into target_workspace_id from public.workflows as wf where wf.id = p_workflow_id;
  if not found or not private.is_workspace_member(target_workspace_id) then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;
  previous_history_flag := pg_catalog.current_setting('aivanta.allow_history_audit_write', true);
  perform pg_catalog.set_config('aivanta.allow_history_audit_write', 'on', true);
  return query select recorded.run_id, recorded.workflow_version
    from private.record_workflow_dry_run_legacy(p_workflow_id,p_expected_version,p_status,p_duration_ms,p_error_message,p_steps) as recorded;
  perform pg_catalog.set_config('aivanta.allow_history_audit_write', coalesce(previous_history_flag, ''), true);
end;
$$;

create or replace function private.guard_history_audit_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('aivanta.allow_history_audit_write', true), '') <> 'on' then
    raise exception 'Use the validated workflow RPC to write version history and audit events' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.guard_workflow_definition_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('aivanta.allow_workflow_definition_write', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.definition is distinct from '{}'::jsonb or new.version <> 1 then
      raise exception 'Create an empty workflow first, then save its definition through the validated RPC' using errcode = '42501';
    end if;
  elsif new.definition is distinct from old.definition or new.version is distinct from old.version then
    raise exception 'Use save_workflow_definition to change workflow definitions or versions' using errcode = '42501';
  end if;
  return new;
end;
$$;
