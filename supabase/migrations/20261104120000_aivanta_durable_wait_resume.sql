-- Durable Wait/Delay support. Waiting jobs release their lease and resume
-- from persisted step checkpoints without consuming a retry attempt.
alter table public.execution_jobs
  drop constraint if exists execution_jobs_status_check;
alter table public.execution_jobs
  add constraint execution_jobs_status_check
  check (status in ('queued','running','retry_wait','waiting','succeeded','dead_letter'));

create or replace function public.claim_execution_jobs(
  p_worker_id text, p_limit integer default 5, p_lease_seconds integer default 120
) returns setof public.execution_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  if p_worker_id is null or length(p_worker_id) not between 1 and 100
     or p_limit not between 1 and 25 or p_lease_seconds not between 15 and 600 then
    raise exception using errcode = '22023', message = 'Invalid worker claim parameters';
  end if;

  with exhausted as (
    select j.id from public.execution_jobs j
    where j.status = 'running' and j.lease_until < now()
      and j.attempts >= j.max_attempts
    for update skip locked
  ), copied as (
    insert into public.execution_dead_letters
      (original_job_id, workspace_id, workflow_id, run_id, idempotency_key, attempts, error_code, payload)
    select j.id, j.workspace_id, j.workflow_id, j.run_id, j.idempotency_key,
      j.attempts, 'WORKER_LEASE_EXHAUSTED', j.payload
    from public.execution_jobs j join exhausted e on e.id = j.id
    on conflict (original_job_id) do nothing
    returning run_id
  )
  update public.execution_jobs j
  set status = 'dead_letter', completed_at = now(),
      lease_token = null, lease_until = null,
      last_error_code = 'WORKER_LEASE_EXHAUSTED'
  where j.id in (select id from exhausted);

  update public.workflow_runs r
  set status = 'failed', completed_at = now(),
      error_message = 'Execution moved to dead-letter queue (WORKER_LEASE_EXHAUSTED)'
  where r.id in (
    select d.run_id from public.execution_dead_letters d
    join public.execution_jobs j on j.id = d.original_job_id
    where j.status = 'dead_letter' and j.last_error_code = 'WORKER_LEASE_EXHAUSTED'
  ) and r.status = 'running';

  return query
  with candidates as (
    select j.id from public.execution_jobs j
    where ((j.status in ('queued','retry_wait','waiting') and j.available_at <= now())
       or (j.status = 'running' and j.lease_until < now()))
      and (j.status = 'waiting' or j.attempts < j.max_attempts)
    order by j.available_at, j.created_at
    for update skip locked
    limit p_limit
  )
  update public.execution_jobs j
  set status = 'running',
      attempts = case when j.status = 'waiting' then j.attempts else j.attempts + 1 end,
      lease_token = gen_random_uuid(),
      lease_until = now() + make_interval(secs => p_lease_seconds),
      worker_id = p_worker_id,
      started_at = coalesce(j.started_at, now())
  from candidates c where j.id = c.id
  returning j.*;
end;
$$;
revoke all on function public.claim_execution_jobs(text,integer,integer) from public, anon, authenticated;
grant execute on function public.claim_execution_jobs(text,integer,integer) to service_role;

create or replace function public.pause_execution_job(
  p_job_id uuid, p_lease_token uuid, p_delay_seconds integer
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare affected integer;
begin
  if p_delay_seconds is null or p_delay_seconds < 1 or p_delay_seconds > 2592000 then
    raise exception using errcode = '22023', message = 'Invalid execution wait duration';
  end if;
  update public.execution_jobs
  set status = 'waiting',
      available_at = now() + make_interval(secs => p_delay_seconds),
      lease_token = null, lease_until = null,
      last_error_code = null
  where id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_until > now();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.pause_execution_job(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.pause_execution_job(uuid,uuid,integer) to service_role;
