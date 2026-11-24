-- Auditable operator recovery for permanently failed dry-run jobs.
-- Live jobs may have an uncertain provider outcome and are intentionally not replayable here.
create table if not exists public.execution_dead_letter_recoveries (
  id uuid primary key default gen_random_uuid(),
  dead_letter_id uuid not null references public.execution_dead_letters(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  recovery_job_id uuid not null unique references public.execution_jobs(id) on delete cascade,
  recovery_run_id uuid not null unique references public.workflow_runs(id) on delete cascade,
  request_id uuid not null,
  recovery_mode text not null default 'dry_run' check (recovery_mode = 'dry_run'),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  constraint execution_dead_letter_recoveries_request_unique unique (dead_letter_id, request_id)
);

create index if not exists execution_dead_letter_recoveries_workspace_idx
  on public.execution_dead_letter_recoveries (workspace_id, requested_at desc);
create index if not exists execution_dead_letter_recoveries_dead_letter_idx
  on public.execution_dead_letter_recoveries (dead_letter_id, requested_at desc);

alter table public.execution_dead_letter_recoveries enable row level security;
revoke all on public.execution_dead_letter_recoveries from public, anon, authenticated;
grant all on public.execution_dead_letter_recoveries to service_role;

create or replace function public.create_dead_letter_dry_run_recovery(
  p_dead_letter_id uuid,
  p_workspace_id uuid,
  p_created_by uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dead_row public.execution_dead_letters%rowtype;
  source_job public.execution_jobs%rowtype;
  existing_recovery public.execution_dead_letter_recoveries%rowtype;
  new_run_id uuid;
  new_job_id uuid;
  replay_key text;
begin
  if p_dead_letter_id is null or p_workspace_id is null
     or p_created_by is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'Invalid dead-letter recovery request';
  end if;

  -- Serialize recovery attempts for this dead letter before checking the
  -- request key. A repeated request returns the same recovery run and job.
  select * into dead_row
  from public.execution_dead_letters d
  where d.id = p_dead_letter_id and d.workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Dead letter not found';
  end if;

  select * into existing_recovery
  from public.execution_dead_letter_recoveries r
  where r.dead_letter_id = dead_row.id and r.request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'recovery_id', existing_recovery.id,
      'job_id', existing_recovery.recovery_job_id,
      'run_id', existing_recovery.recovery_run_id,
      'mode', existing_recovery.recovery_mode,
      'duplicate', true
    );
  end if;

  select * into source_job
  from public.execution_jobs j
  where j.id = dead_row.original_job_id
    and j.workspace_id = p_workspace_id
    and j.workflow_id = dead_row.workflow_id
    and j.run_id = dead_row.run_id
    and j.status = 'dead_letter'
    and j.execution_mode = 'dry_run'
  for share;
  if not found then
    raise exception using errcode = '22023',
      message = 'Only permanently failed dry-run jobs can be recovered automatically';
  end if;

  replay_key := 'dead-letter-recovery:' || dead_row.id::text || ':' || p_request_id::text;

  insert into public.workflow_runs (
    workspace_id, workflow_id, workflow_version, mode, status, created_by,
    idempotency_key, started_at, completed_at, duration_ms
  ) values (
    p_workspace_id, source_job.workflow_id, source_job.workflow_version,
    'dry_run', 'running', p_created_by, replay_key, now(), null, 0
  ) returning id into new_run_id;

  insert into public.execution_jobs (
    workspace_id, workflow_id, run_id, workflow_version, workflow_definition,
    execution_mode, idempotency_key, payload, max_attempts, available_at
  ) values (
    p_workspace_id, source_job.workflow_id, new_run_id, source_job.workflow_version,
    source_job.workflow_definition, 'dry_run', replay_key, source_job.payload,
    source_job.max_attempts, now()
  ) returning id into new_job_id;

  insert into public.execution_dead_letter_recoveries (
    dead_letter_id, workspace_id, recovery_job_id, recovery_run_id,
    request_id, recovery_mode, requested_by
  ) values (
    dead_row.id, p_workspace_id, new_job_id, new_run_id,
    p_request_id, 'dry_run', p_created_by
  ) returning * into existing_recovery;

  return jsonb_build_object(
    'recovery_id', existing_recovery.id,
    'job_id', new_job_id,
    'run_id', new_run_id,
    'mode', 'dry_run',
    'duplicate', false
  );
end;
$$;

revoke all on function public.create_dead_letter_dry_run_recovery(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.create_dead_letter_dry_run_recovery(uuid,uuid,uuid,uuid)
  to service_role;
