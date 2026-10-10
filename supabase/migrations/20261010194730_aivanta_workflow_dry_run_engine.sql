-- Atomically persist a validated workflow dry-run and its step results.
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
  workflow_workspace_id uuid;
  current_version integer;
  new_run_id uuid;
  step_item record;
  step_id_value text;
  step_type_value text;
  step_title_value text;
  step_status_value text;
  step_result_value jsonb;
  step_position integer := 0;
  has_failed_step boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_status not in ('succeeded', 'failed') then
    raise exception 'Invalid dry-run status' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'A valid workflow version is required' using errcode = '22023';
  end if;
  if p_duration_ms is null or p_duration_ms < 0 or p_duration_ms > 600000 then
    raise exception 'Dry-run duration is outside the allowed range' using errcode = '22023';
  end if;
  if p_error_message is not null and pg_catalog.char_length(p_error_message) > 500 then
    raise exception 'Error messages cannot exceed 500 characters' using errcode = '22023';
  end if;
  if p_status = 'failed' and pg_catalog.btrim(coalesce(p_error_message, '')) = '' then
    raise exception 'Failed runs require an error message' using errcode = '22023';
  end if;
  if p_steps is null or pg_catalog.jsonb_typeof(p_steps) <> 'array'
     or pg_catalog.jsonb_array_length(p_steps) < 1
     or pg_catalog.jsonb_array_length(p_steps) > 30 then
    raise exception 'A dry-run must contain between 1 and 30 step results' using errcode = '22023';
  end if;

  select wf.workspace_id, wf.version
    into workflow_workspace_id, current_version
    from public.workflows as wf
   where wf.id = p_workflow_id
   for share;
  if not found then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;
  if current_version <> p_expected_version then
    raise exception 'Workflow version changed during the dry-run' using errcode = '40001';
  end if;

  insert into public.workflow_runs (
    workspace_id, workflow_id, workflow_version, mode, status, created_by, duration_ms, error_message
  ) values (
    workflow_workspace_id, p_workflow_id, current_version, 'dry_run', p_status, auth.uid(),
    p_duration_ms, nullif(pg_catalog.btrim(p_error_message), '')
  ) returning id into new_run_id;

  for step_item in
    select element.value, element.ordinality
      from pg_catalog.jsonb_array_elements(p_steps) with ordinality as element(value, ordinality)
     order by element.ordinality
  loop
    step_position := step_position + 1;
    if pg_catalog.jsonb_typeof(step_item.value) <> 'object' then
      raise exception 'Each step result must be an object' using errcode = '22023';
    end if;
    step_id_value := step_item.value ->> 'step_id';
    step_type_value := step_item.value ->> 'step_type';
    step_title_value := step_item.value ->> 'title';
    step_status_value := step_item.value ->> 'status';
    step_result_value := step_item.value -> 'result';

    if step_id_value is null or pg_catalog.char_length(step_id_value) < 1 or pg_catalog.char_length(step_id_value) > 64 then
      raise exception 'Each step result needs a valid step ID' using errcode = '22023';
    end if;
    if step_type_value not in ('trigger', 'action', 'condition') then
      raise exception 'Invalid step result type' using errcode = '22023';
    end if;
    if step_title_value is null or pg_catalog.char_length(step_title_value) < 1 or pg_catalog.char_length(step_title_value) > 80 then
      raise exception 'Invalid step result title' using errcode = '22023';
    end if;
    if step_status_value not in ('simulated', 'skipped', 'failed') then
      raise exception 'Invalid step result status' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(step_result_value) <> 'object' then
      raise exception 'Step results must be JSON objects' using errcode = '22023';
    end if;
    if pg_catalog.octet_length(step_result_value::text) > 8000 then
      raise exception 'A step result cannot exceed 8 KB' using errcode = '22023';
    end if;
    if step_status_value = 'failed' then has_failed_step := true; end if;

    insert into public.workflow_run_steps (
      run_id, workspace_id, step_id, position, step_type, title, status, result
    ) values (
      new_run_id, workflow_workspace_id, step_id_value, step_position,
      step_type_value, step_title_value, step_status_value, step_result_value
    );
  end loop;

  if p_status = 'succeeded' and has_failed_step then
    raise exception 'A successful run cannot contain failed steps' using errcode = '22023';
  end if;
  if p_status = 'failed' and not has_failed_step then
    raise exception 'A failed run must contain a failed step' using errcode = '22023';
  end if;

  insert into public.audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id, metadata
  ) values (
    workflow_workspace_id, auth.uid(), 'workflow.dry_run_completed', 'workflow_run',
    new_run_id::text,
    pg_catalog.jsonb_build_object('workflow_id', p_workflow_id, 'workflow_version', current_version, 'status', p_status, 'step_count', step_position, 'duration_ms', p_duration_ms)
  );

  return query select new_run_id, current_version;
end;
$$;

revoke all on function public.record_workflow_dry_run(uuid, integer, text, integer, text, jsonb) from public, anon;
grant execute on function public.record_workflow_dry_run(uuid, integer, text, integer, text, jsonb) to authenticated;
