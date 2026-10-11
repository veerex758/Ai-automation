-- Persist scheduled executions as safe dry-runs until live scheduled side effects
-- have passed dedicated staging gates. The lease and run history write are
-- checked in one transaction so a retry cannot create duplicate run records.
-- Do not let workspace members alter schedule configuration while a worker
-- owns a lease; this keeps the claimed occurrence and idempotency key stable.
drop policy if exists "workspace members can update workflow schedules" on public.workflow_schedules;
create policy "workspace members can update unclaimed workflow schedules"
  on public.workflow_schedules for update to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and lease_token is null
  )
  with check (
    private.is_workspace_member(workspace_id)
    and lease_token is null
    and exists (
      select 1 from public.workflows w
      where w.id = workflow_schedules.workflow_id
        and w.workspace_id = workflow_schedules.workspace_id
    )
  );

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

  select s.*
    into current_schedule
    from public.workflow_schedules as s
   where s.id = p_schedule_id
     and s.lease_token = p_lease_token
     and s.lease_until > now()
     and s.enabled = true
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Schedule claim is no longer valid';
  end if;

  select w.version, w.definition
    into current_workflow_version, current_definition
    from public.workflows as w
   where w.id = current_schedule.workflow_id
     and w.workspace_id = current_schedule.workspace_id
     and w.status = 'active'
     and w.version = p_expected_version
     and pg_catalog.jsonb_typeof(w.definition->'nodes') = 'array'
     and w.definition->'nodes'->0->'settings'->>'event' = 'schedule'
   for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workflow changed or is no longer schedulable';
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

-- If a run-history write committed but its RPC response was lost, do not
-- back off and accidentally turn that same occurrence into a new idempotency
-- key. A successful durable run record is authoritative for finalization.
create or replace function public.finish_workflow_schedule_claim(
  p_schedule_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $finish_workflow_schedule_claim$
declare
  current_schedule public.workflow_schedules%rowtype;
  safe_error_code text;
  effective_succeeded boolean := coalesce(p_succeeded, false);
  existing_run record;
  expected_idempotency_key text;
begin
  select * into current_schedule
  from public.workflow_schedules
  where id = p_schedule_id
    and lease_token = p_lease_token
    and lease_until > now()
  for update;

  if not found then
    return false;
  end if;

  expected_idempotency_key := current_schedule.id::text || ':' ||
    pg_catalog.to_char(
      current_schedule.next_run_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    );

  if not effective_succeeded then
    select r.id, r.workflow_id, r.workflow_version, r.mode, r.status
      into existing_run
      from public.workflow_runs as r
     where r.idempotency_key = expected_idempotency_key;

    if found then
      if existing_run.workflow_id <> current_schedule.workflow_id
         or existing_run.mode <> 'dry_run'
         or existing_run.status <> 'succeeded' then
        raise exception using errcode = '23505', message = 'Scheduled run idempotency conflict';
      end if;

      -- The durable run captures the version that actually executed. A later
      -- workflow edit must not turn a committed run into a retry of that occurrence.
      effective_succeeded := true;
    end if;
  end if;

  safe_error_code := case
    when p_error_code ~ '^[A-Z0-9_]{1,64}
    else 'SCHEDULED_RUN_FAILED'
  end;

  if effective_succeeded then
    update public.workflow_schedules
    set last_run_at = current_schedule.next_run_at,
        next_run_at = greatest(
          current_schedule.next_run_at + make_interval(mins => current_schedule.interval_minutes),
          now() + make_interval(mins => current_schedule.interval_minutes)
        ),
        failure_count = 0,
        last_error_code = null,
        lease_token = null,
        lease_until = null
    where id = p_schedule_id;
  else
    update public.workflow_schedules
    set failure_count = failure_count + 1,
        last_error_code = safe_error_code,
        next_run_at = now() + make_interval(mins => least(60, 5 * power(2, least(failure_count, 4))::integer)),
        lease_token = null,
        lease_until = null
    where id = p_schedule_id;
  end if;

  return true;
end;
$finish_workflow_schedule_claim$;

 then p_error_code
    else 'SCHEDULED_RUN_FAILED'
  end;

  if effective_succeeded then
    update public.workflow_schedules
    set last_run_at = current_schedule.next_run_at,
        next_run_at = greatest(
          current_schedule.next_run_at + make_interval(mins => current_schedule.interval_minutes),
          now() + make_interval(mins => current_schedule.interval_minutes)
        ),
        failure_count = 0,
        last_error_code = null,
        lease_token = null,
        lease_until = null
    where id = p_schedule_id;
  else
    update public.workflow_schedules
    set failure_count = failure_count + 1,
        last_error_code = safe_error_code,
        next_run_at = now() + make_interval(mins => least(60, 5 * power(2, least(failure_count, 4))::integer)),
        lease_token = null,
        lease_until = null
    where id = p_schedule_id;
  end if;

  return true;
end;
$finish_workflow_schedule_claim$;

