-- Durable execution cancellation.
-- Queued work can be cancelled immediately; leased work receives a request
-- that the worker observes before the next operation and during heartbeats.
alter table public.execution_jobs
  add column if not exists cancel_requested_at timestamptz;

alter table public.execution_jobs
  drop constraint if exists execution_jobs_status_check;
alter table public.execution_jobs
  add constraint execution_jobs_status_check
  check (status in ('queued','running','retry_wait','waiting','succeeded','dead_letter','cancelled'));

create or replace function public.cancel_execution_job(
  p_job_id uuid,
  p_workspace_id uuid,
  p_workflow_id uuid
) returns text
language plpgsql security definer set search_path = ''
as $$
declare job_row public.execution_jobs%rowtype;
begin
  if p_job_id is null or p_workspace_id is null or p_workflow_id is null then
    raise exception using errcode = '22023', message = 'Invalid execution cancellation request';
  end if;
  select * into job_row from public.execution_jobs
  where id = p_job_id and workspace_id = p_workspace_id and workflow_id = p_workflow_id
  for update;
  if not found then return 'not_found'; end if;

  if job_row.status in ('queued','retry_wait','waiting') then
    update public.execution_jobs
    set status = 'cancelled', cancel_requested_at = coalesce(cancel_requested_at, now()),
        completed_at = now(), last_error_code = 'EXECUTION_CANCELLED',
        lease_token = null, lease_until = null
    where id = p_job_id;
    update public.workflow_runs
    set status = 'cancelled', completed_at = now(),
        error_message = 'Execution cancelled by a workspace member'
    where id = job_row.run_id and status = 'running';
    return 'cancelled';
  end if;

  if job_row.status = 'running' then
    update public.execution_jobs
    set cancel_requested_at = coalesce(cancel_requested_at, now())
    where id = p_job_id;
    return 'cancellation_requested';
  end if;

  return 'not_cancellable';
end;
$$;
revoke all on function public.cancel_execution_job(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.cancel_execution_job(uuid,uuid,uuid) to service_role;

create or replace function public.finish_cancelled_execution_job(
  p_job_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare job_row public.execution_jobs%rowtype;
declare affected integer;
begin
  select * into job_row from public.execution_jobs
  where id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_until > now()
    and cancel_requested_at is not null
  for update;
  if not found then return false; end if;

  update public.execution_jobs
  set status = 'cancelled', completed_at = now(),
      lease_token = null, lease_until = null,
      last_error_code = 'EXECUTION_CANCELLED'
  where id = p_job_id;
  get diagnostics affected = row_count;
  if affected <> 1 then return false; end if;

  update public.workflow_runs
  set status = 'cancelled', completed_at = now(),
      error_message = 'Execution cancelled by a workspace member'
  where id = job_row.run_id and status = 'running';
  return true;
end;
$$;
revoke all on function public.finish_cancelled_execution_job(uuid,uuid) from public, anon, authenticated;
grant execute on function public.finish_cancelled_execution_job(uuid,uuid) to service_role;


-- Finalization checks cancellation under the same row lock as success/failure,
-- so a cancel request racing the final checkpoint cannot be overwritten by success.
create or replace function public.finish_execution_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error_code text default null,
  p_error_step_id text default null,
  p_error_message text default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  job_row public.execution_jobs%rowtype;
  safe_code text;
  safe_step_id text;
  delay_seconds integer;
begin
  select * into job_row from public.execution_jobs
  where id=p_job_id and status='running'
    and lease_token=p_lease_token and lease_until > now()
  for update;
  if not found then return 'lease_lost'; end if;

  if job_row.cancel_requested_at is not null then
    update public.execution_jobs set status='cancelled',completed_at=now(),
      lease_token=null,lease_until=null,last_error_code='EXECUTION_CANCELLED'
      where id=p_job_id;
    update public.workflow_runs set status='cancelled',completed_at=now(),
      error_message='Execution cancelled by a workspace member'
      where id=job_row.run_id and status='running';
    return 'cancelled';
  end if;

  if coalesce(p_succeeded,false) then
    update public.execution_jobs set status='succeeded',completed_at=now(),
      lease_token=null,lease_until=null,last_error_code=null where id=p_job_id;
    update public.workflow_runs set status='succeeded',completed_at=now(),
      duration_ms=least(600000,greatest(0,(extract(epoch from (now()-started_at))*1000)::integer))
      where id=job_row.run_id and status='running';
    return 'succeeded';
  end if;

  safe_code := case when p_error_code ~ '^[A-Z0-9_]{1,64}$' then p_error_code else 'EXECUTION_FAILED' end;
  if job_row.execution_mode='live' then
    safe_step_id := case when p_error_step_id ~ '^[a-zA-Z0-9_-]{1,64}$' then p_error_step_id else 'workflow' end;
    insert into public.execution_error_events(
      workspace_id,workflow_id,workflow_run_id,job_id,step_id,attempt,error_code,safe_message
    ) values(
      job_row.workspace_id,job_row.workflow_id,job_row.run_id,job_row.id,safe_step_id,
      greatest(1,least(20,job_row.attempts)),safe_code,left(coalesce(p_error_message,safe_code),2000)
    ) on conflict(job_id,step_id,attempt) do nothing;
  end if;
  if job_row.attempts >= job_row.max_attempts then
    insert into public.execution_dead_letters
      (original_job_id,workspace_id,workflow_id,run_id,idempotency_key,attempts,error_code,payload)
    values(job_row.id,job_row.workspace_id,job_row.workflow_id,job_row.run_id,
      job_row.idempotency_key,job_row.attempts,safe_code,job_row.payload)
    on conflict(original_job_id) do nothing;
    update public.execution_jobs set status='dead_letter',completed_at=now(),
      lease_token=null,lease_until=null,last_error_code=safe_code where id=p_job_id;
    update public.workflow_runs set status='failed',completed_at=now(),
      error_message='Execution moved to dead-letter queue ('||safe_code||')'
      where id=job_row.run_id and status='running';
    return 'dead_letter';
  end if;
  delay_seconds := least(3600,(5*pg_catalog.power(2,least(job_row.attempts-1,9)))::integer);
  update public.execution_jobs set status='retry_wait',
    available_at=now()+make_interval(secs=>delay_seconds),
    lease_token=null,lease_until=null,last_error_code=safe_code where id=p_job_id;
  return 'retry_wait';
end;
$$;
revoke all on function public.finish_execution_job(uuid,uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_execution_job(uuid,uuid,boolean,text,text,text) to service_role;
