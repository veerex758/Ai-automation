-- Route definition/history/audit writes through validated RPCs instead of broad table grants.
-- Legacy bodies retain the established validation logic but are callable only by
-- the owner; these wrappers perform an explicit workspace membership check and
-- execute with a fixed empty search_path.

alter function public.save_workflow_definition(uuid, jsonb)
  rename to save_workflow_definition_legacy;
alter function public.record_workflow_dry_run(uuid, integer, text, integer, text, jsonb)
  rename to record_workflow_dry_run_legacy;

revoke all on function public.save_workflow_definition_legacy(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_workflow_dry_run_legacy(uuid, integer, text, integer, text, jsonb)
  from public, anon, authenticated;

create function public.save_workflow_definition(
  p_workflow_id uuid,
  p_definition jsonb
)
returns table (saved_workflow_id uuid, saved_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select wf.workspace_id
    into target_workspace_id
    from public.workflows as wf
   where wf.id = p_workflow_id;

  if not found then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;
  if not private.is_workspace_member(target_workspace_id) then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;

  return query
    select saved.saved_workflow_id, saved.saved_version
      from public.save_workflow_definition_legacy(p_workflow_id, p_definition) as saved;
end;
$$;

revoke all on function public.save_workflow_definition(uuid, jsonb) from public, anon;
grant execute on function public.save_workflow_definition(uuid, jsonb) to authenticated;

create function public.record_workflow_dry_run(
  p_workflow_id uuid,
  p_expected_version integer,
  p_status text,
  p_duration_ms integer,
  p_error_message text,
  p_steps jsonb
)
returns table (run_id uuid, workflow_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select wf.workspace_id
    into target_workspace_id
    from public.workflows as wf
   where wf.id = p_workflow_id;

  if not found then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;
  if not private.is_workspace_member(target_workspace_id) then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;

  return query
    select recorded.run_id, recorded.workflow_version
      from public.record_workflow_dry_run_legacy(
        p_workflow_id, p_expected_version, p_status, p_duration_ms, p_error_message, p_steps
      ) as recorded;
end;
$$;

revoke all on function public.record_workflow_dry_run(uuid, integer, text, integer, text, jsonb)
  from public, anon;
grant execute on function public.record_workflow_dry_run(uuid, integer, text, integer, text, jsonb)
  to authenticated;

-- Direct workflow metadata edits remain available to members, but the definition
-- and version columns can only be changed through save_workflow_definition.
revoke update on public.workflows from public, anon, authenticated;
grant update (name, description, status) on public.workflows to authenticated;

-- Prevent clients from forging version snapshots or audit events directly.
revoke insert on public.workflow_versions, public.audit_events from public, anon, authenticated;
drop policy if exists workflow_versions_insert_member on public.workflow_versions;
drop policy if exists audit_events_insert_member on public.audit_events;
