-- Persist scheduled executions as safe dry-runs until live scheduled side effects
-- have passed dedicated staging gates. The lease and run history write are
-- checked in one transaction so a retry cannot create duplicate run records.
create or replace function public.record_scheduled_workflow_run(
  p_schedule_id uuid,
  p_lease_token uuid,
  p_expected_version integer,
  p_duration_ms integer,
  p_steps jsonb
)
returns table (run_id uuid, workflow_version integer)
language plpgsql
security definer
set search_path = ''
as $record_scheduled_workflow_run$
declare
  current_schedule public.workflow_schedules%rowtype;
  current_workflow_version integer;
  current_definition jsonb;
  schedule_idempotency_key text;
  existing_run_id uuid;
  existing_workflow_version integer;
  existing_status text;
  existing_mode text;
  new_run_id uuid;
  step_item record;
  step_id_value text;
  step_type_value text;
  step_title_value text;
  step_status_value text;
  step_result_value jsonb;
  step_position integer := 0;
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'Invalid workflow version';
  end if;
  if p_duration_ms is null or p_duration_ms < 0 or p_duration_ms > 600000 then
    raise exception using errcode = '22023', message = 'Invalid run duration';
  end if;
  if p_steps is null or pg_catalog.jsonb_typeof(p_steps) <> 'array' then
    raise exception using errcode = '22023', message = 'Invalid scheduled run steps';
  end if;
  if pg_catalog.jsonb_array_length(p_steps) < 1
     or pg_catalog.jsonb_array_length(p_steps) > 30 then
    raise exception using errcode = '22023', message = 'Invalid scheduled run steps';
  end if;

  select s, w.version, w.definition
    into current_schedule, current_workflow_version, current_definition
    from public.workflow_schedules as s
    join public.workflows as w
      on w.id = s.workflow_id and w.workspace_id = s.workspace_id
   where s.id = p_schedule_id
     and s.lease_token = p_lease_token
     and s.lease_until > now()
     and s.enabled = true
     and w.status = 'active'
     and w.version = p_expected_version
     and pg_catalog.jsonb_typeof(w.definition->'nodes') = 'array'
     and w.definition->'nodes'->0->'settings'->>'event' = 'schedule'
   for update of s;

  if not found then
    raise exception using errcode = 'P0002', message = 'Schedule claim is no longer valid';
  end if;

  if pg_catalog.jsonb_array_length(current_definition->'nodes') <> pg_catalog.jsonb_array_length(p_steps) then
    raise exception using errcode = '22023', message = 'Scheduled run step count does not match workflow';
  end if;

  schedule_idempotency_key := current_schedule.id::text || ':' || pg_catalog.to_char(current_schedule.next_run_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

  select r.id, r.workflow_version, r.status, r.mode
    into existing_run_id, existing_workflow_version, existing_status, existing_mode
    from public.workflow_runs as r
   where r.idempotency_key = schedule_idempotency_key;

  if found then
    if existing_status <> 'succeeded' or existing_mode <> 'dry_run'
       or existing_workflow_version <> current_workflow_version then
      raise exception using errcode = '23505', message = 'Scheduled run idempotency conflict';
    end if;
    return query select existing_run_id, existing_workflow_version;
    return;
  end if;

  insert into public.workflow_runs (
    workspace_id, workflow_id, workflow_version, mode, status, created_by,
    started_at, completed_at, duration_ms, error_message, idempotency_key
  ) values (
    current_schedule.workspace_id, current_schedule.workflow_id, current_workflow_version,
    'dry_run', 'succeeded', current_schedule.created_by,
    now() - (p_duration_ms * interval '1 millisecond'), now(), p_duration_ms, null,
    schedule_idempotency_key
  ) returning id into new_run_id;

  for step_item in
    select element.value, element.ordinality
      from pg_catalog.jsonb_array_elements(p_steps) with ordinality as element(value, ordinality)
     order by element.ordinality
  loop
    if pg_catalog.jsonb_typeof(step_item.value) <> 'object' then
      raise exception using errcode = '22023', message = 'Each scheduled step result must be an object';
    end if;

    step_id_value := step_item.value ->> 'step_id';
    step_type_value := step_item.value ->> 'step_type';
    step_title_value := step_item.value ->> 'title';
    step_status_value := step_item.value ->> 'status';
    step_result_value := step_item.value -> 'result';
    step_position := step_position + 1;

    if step_id_value is null or pg_catalog.char_length(step_id_value) < 1
       or pg_catalog.char_length(step_id_value) > 64 then
      raise exception using errcode = '22023', message = 'Invalid scheduled step ID';
    end if;
    if step_type_value is null or step_type_value not in ('trigger', 'action', 'condition') then
      raise exception using errcode = '22023', message = 'Invalid scheduled step type';
    end if;
    if step_title_value is null or pg_catalog.char_length(step_title_value) < 1
       or pg_catalog.char_length(step_title_value) > 80 then
      raise exception using errcode = '22023', message = 'Invalid scheduled step title';
    end if;
    if step_status_value is null or step_status_value not in ('simulated', 'skipped') then
      raise exception using errcode = '22023', message = 'Scheduled dispatcher only records side-effect-free dry-runs';
    end if;
    if step_result_value is null
       or pg_catalog.jsonb_typeof(step_result_value) <> 'object'
       or pg_catalog.octet_length(step_result_value::text) > 8000 then
      raise exception using errcode = '22023', message = 'Invalid scheduled step result';
    end if;
    if not exists (
      select 1
        from pg_catalog.jsonb_array_elements(current_definition->'nodes') with ordinality as workflow_node(value, ordinality)
       where workflow_node.ordinality = step_position
         and workflow_node.value->>'id' = step_id_value
         and workflow_node.value->>'type' = step_type_value
         and pg_catalog.btrim(workflow_node.value->>'title') = step_title_value
    ) then
      raise exception using errcode = '22023', message = 'Scheduled step does not belong to the current workflow';
    end if;

    insert into public.workflow_run_steps (
      run_id, workspace_id, step_id, position, step_type, title, status, result
    ) values (
      new_run_id, current_schedule.workspace_id, step_id_value, step_position,
      step_type_value, step_title_value, step_status_value, step_result_value
    );
  end loop;

  return query select new_run_id, current_workflow_version;
end;
$record_scheduled_workflow_run$;

revoke all on function public.record_scheduled_workflow_run(uuid, uuid, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_scheduled_workflow_run(uuid, uuid, integer, integer, jsonb)
  to service_role;
