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
  p_workspace_id uuid
) returns text
language plpgsql security definer set search_path = ''
as $$
declare job_row public.execution_jobs%rowtype;
begin
  if p_job_id is null or p_workspace_id is null then
    raise exception using errcode = '22023', message = 'Invalid execution cancellation request';
  end if;
  select * into job_row from public.execution_jobs
  where id = p_job_id and workspace_id = p_workspace_id
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
revoke all on function public.cancel_execution_job(uuid,uuid) from public, anon, authenticated;
grant execute on function public.cancel_execution_job(uuid,uuid) to service_role;

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
