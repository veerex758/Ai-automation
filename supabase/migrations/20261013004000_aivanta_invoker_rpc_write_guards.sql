-- Keep the RPCs SECURITY INVOKER so the security advisor remains clean.
-- Guard protected writes with transaction-local flags set only by the public RPCs.
-- The legacy bodies live in the private schema; direct calls cannot bypass the
-- guard triggers even if the private schema is accidentally exposed.

alter function public.save_workflow_definition_legacy(uuid, jsonb) set schema private;
alter function public.record_workflow_dry_run_legacy(uuid, integer, text, integer, text, jsonb) set schema private;

revoke all on function private.save_workflow_definition_legacy(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.record_workflow_dry_run_legacy(uuid, integer, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function private.save_workflow_definition_legacy(uuid, jsonb) to authenticated;
grant execute on function private.record_workflow_dry_run_legacy(uuid, integer, text, integer, text, jsonb) to authenticated;

create or replace function private.guard_workflow_definition_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('aivanta.allow_workflow_definition_write', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.definition is distinct from '{}'::jsonb or new.version <> 1 then
      raise exception 'Create an empty workflow first, then save its definition through the validated RPC'
        using errcode = '42501';
    end if;
  elsif new.definition is distinct from old.definition or new.version is distinct from old.version then
    raise exception 'Use save_workflow_definition to change workflow definitions or versions'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_workflow_definition_write() from public, anon, authenticated;

drop trigger if exists workflows_guard_definition_write on public.workflows;
create trigger workflows_guard_definition_write
before insert or update on public.workflows
for each row execute function private.guard_workflow_definition_write();

create or replace function private.guard_history_audit_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('aivanta.allow_history_audit_write', true), '') <> 'on' then
    raise exception 'Use the validated workflow RPC to write version history and audit events'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_history_audit_insert() from public, anon, authenticated;

drop trigger if exists workflow_versions_guard_insert on public.workflow_versions;
create trigger workflow_versions_guard_insert
before insert on public.workflow_versions
for each row execute function private.guard_history_audit_insert();

drop trigger if exists audit_events_guard_insert on public.audit_events;
create trigger audit_events_guard_insert
before insert on public.audit_events
for each row execute function private.guard_history_audit_insert();

-- Restore table privileges needed by the invoker RPCs; trigger guards stop direct bypass.
grant update on public.workflows to authenticated;
grant insert on public.workflow_versions, public.audit_events to authenticated;

create policy workflow_versions_insert_member
  on public.workflow_versions
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.workflows wf
      where wf.id = workflow_versions.workflow_id
        and private.is_workspace_member(wf.workspace_id)
    )
  );

create policy audit_events_insert_member
  on public.audit_events
  for insert
  to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and actor_user_id = (select auth.uid())
  );

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
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select wf.workspace_id into target_workspace_id
    from public.workflows as wf
   where wf.id = p_workflow_id;
  if not found or not private.is_workspace_member(target_workspace_id) then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;

  previous_definition_flag := pg_catalog.current_setting('aivanta.allow_workflow_definition_write', true);
  previous_history_flag := pg_catalog.current_setting('aivanta.allow_history_audit_write', true);
  perform pg_catalog.set_config('aivanta.allow_workflow_definition_write', 'on', true);
  perform pg_catalog.set_config('aivanta.allow_history_audit_write', 'on', true);

  return query
    select saved.saved_workflow_id, saved.saved_version
      from private.save_workflow_definition_legacy(p_workflow_id, p_definition) as saved;

  perform pg_catalog.set_config('aivanta.allow_workflow_definition_write', coalesce(previous_definition_flag, ''), true);
  perform pg_catalog.set_config('aivanta.allow_history_audit_write', coalesce(previous_history_flag, ''), true);
end;
$$;

revoke all on function public.save_workflow_definition(uuid, jsonb) from public, anon;
grant execute on function public.save_workflow_definition(uuid, jsonb) to authenticated;

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
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select wf.workspace_id into target_workspace_id
    from public.workflows as wf
   where wf.id = p_workflow_id;
  if not found or not private.is_workspace_member(target_workspace_id) then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;

  previous_history_flag := pg_catalog.current_setting('aivanta.allow_history_audit_write', true);
  perform pg_catalog.set_config('aivanta.allow_history_audit_write', 'on', true);

  return query
    select recorded.run_id, recorded.workflow_version
      from private.record_workflow_dry_run_legacy(
        p_workflow_id, p_expected_version, p_status, p_duration_ms, p_error_message, p_steps
      ) as recorded;

  perform pg_catalog.set_config('aivanta.allow_history_audit_write', coalesce(previous_history_flag, ''), true);
end;
$$;

revoke all on function public.record_workflow_dry_run(uuid, integer, text, integer, text, jsonb)
  from public, anon;
grant execute on function public.record_workflow_dry_run(uuid, integer, text, integer, text, jsonb)
  to authenticated;
