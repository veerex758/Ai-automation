-- Explicitly distinguish safe previews from live queued executions.
-- Live jobs receive a single attempt: an expired lease is never allowed to replay
-- an external action whose provider outcome may be unknown.
alter table public.execution_jobs
  add column if not exists execution_mode text not null default 'dry_run';

alter table public.execution_jobs
  drop constraint if exists execution_jobs_execution_mode_check;
alter table public.execution_jobs
  add constraint execution_jobs_execution_mode_check
  check (execution_mode in ('dry_run', 'live'));

drop function if exists public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer);

create or replace function public.dispatch_workflow_execution(
  p_workspace_id uuid,
  p_workflow_id uuid,
  p_workflow_version integer,
  p_created_by uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer,
  p_execution_mode text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare existing_job public.execution_jobs%rowtype;
declare workflow_row public.workflows%rowtype;
declare new_run_id uuid;
declare new_job_id uuid;
declare effective_attempts integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200
     or p_max_attempts not between 1 and 20
     or p_execution_mode not in ('dry_run', 'live')
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 16384 then
    raise exception using errcode = '22023', message = 'Invalid execution dispatch request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_idempotency_key, 0)
  );

  select * into existing_job from public.execution_jobs
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('job_id', existing_job.id, 'run_id', existing_job.run_id, 'duplicate', true);
  end if;

  select w.* into workflow_row from public.workflows w
  where w.id = p_workflow_id and w.workspace_id = p_workspace_id
    and w.version = p_workflow_version and w.status = 'active'
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'Workflow is not active or version changed';
  end if;

  effective_attempts := case when p_execution_mode = 'live' then 1 else p_max_attempts end;

  insert into public.workflow_runs (
    workspace_id, workflow_id, workflow_version, mode, status, created_by,
    idempotency_key, started_at, completed_at, duration_ms
  ) values (
    p_workspace_id, p_workflow_id, p_workflow_version, p_execution_mode, 'running',
    p_created_by, p_idempotency_key, now(), null, 0
  ) returning id into new_run_id;

  insert into public.execution_jobs (
    workspace_id, workflow_id, run_id, workflow_version, workflow_definition,
    execution_mode, idempotency_key, payload, max_attempts
  ) values (
    p_workspace_id, p_workflow_id, new_run_id, workflow_row.version, workflow_row.definition,
    p_execution_mode, p_idempotency_key, p_payload, effective_attempts
  ) returning id into new_job_id;

  return jsonb_build_object('job_id', new_job_id, 'run_id', new_run_id, 'duplicate', false);
end;
$$;

revoke all on function public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer,text)
  from public, anon, authenticated;
grant execute on function public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer,text)
  to service_role;


-- Preserve the existing seven-argument RPC contract for the scheduler and
-- verified webhook dispatcher. Those callers remain dry-run-only by default.
create or replace function public.dispatch_workflow_execution(
  p_workspace_id uuid,
  p_workflow_id uuid,
  p_workflow_version integer,
  p_created_by uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5
) returns jsonb
language sql security definer set search_path = ''
as $$
  select public.dispatch_workflow_execution(
    p_workspace_id, p_workflow_id, p_workflow_version, p_created_by,
    p_idempotency_key, p_payload, p_max_attempts, 'dry_run'
  );
$$;
revoke all on function public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer)
  from public, anon, authenticated;
grant execute on function public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer)
  to service_role;
