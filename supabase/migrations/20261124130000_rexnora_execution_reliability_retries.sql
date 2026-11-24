-- Rexnora Stage 2 reliability: cancellation-safe lease recovery and bounded retries.
-- Live retries are enabled only when the trusted server dispatcher explicitly
-- requests them for a workflow whose side effects use provider idempotency.
-- Resend's idempotency window is 24 hours; stop automatic retries after 20 hours.

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

  -- Cancellation wins over lease recovery. A worker that disappeared after a
  -- cancellation request must never have its job re-issued to another worker.
  with cancelled as (
    update public.execution_jobs
    set status = 'cancelled', completed_at = now(),
        lease_token = null, lease_until = null,
        last_error_code = 'EXECUTION_CANCELLED'
    where status = 'running' and lease_until < now()
      and cancel_requested_at is not null
    returning run_id
  )
  update public.workflow_runs r
  set status = 'cancelled', completed_at = now(),
      error_message = 'Execution cancelled by a workspace member'
  where r.id in (select run_id from cancelled) and r.status = 'running';

  -- Expired live retry windows are dead-lettered before claim. This leaves a
  -- four-hour safety margin inside Resend's documented 24-hour key retention.
  with exhausted as (
    select j.id,
      case
        when j.execution_mode = 'live' and j.max_attempts > 1
          and j.created_at < now() - interval '20 hours'
        then 'LIVE_RETRY_WINDOW_EXPIRED'
        else 'WORKER_LEASE_EXHAUSTED'
      end as error_code
    from public.execution_jobs j
    where j.cancel_requested_at is null
      and (
        (j.status = 'running' and j.lease_until < now() and (
          j.attempts >= j.max_attempts or
          (j.execution_mode = 'live' and j.max_attempts > 1
            and j.created_at < now() - interval '20 hours')
        ))
        or
        (j.status in ('queued','retry_wait') and j.available_at <= now()
          and j.execution_mode = 'live' and j.max_attempts > 1
          and j.created_at < now() - interval '20 hours')
      )
    for update skip locked
  ), copied as (
    insert into public.execution_dead_letters
      (original_job_id, workspace_id, workflow_id, run_id, idempotency_key, attempts, error_code, payload)
    select j.id, j.workspace_id, j.workflow_id, j.run_id, j.idempotency_key,
      j.attempts, e.error_code, j.payload
    from public.execution_jobs j join exhausted e on e.id = j.id
    on conflict (original_job_id) do nothing
    returning original_job_id
  )
  update public.execution_jobs j
  set status = 'dead_letter', completed_at = now(),
      lease_token = null, lease_until = null,
      last_error_code = e.error_code
  from exhausted e
  where j.id = e.id;

  update public.workflow_runs r
  set status = 'failed', completed_at = now(),
      error_message = 'Execution moved to dead-letter queue (' || j.last_error_code || ')'
  from public.execution_jobs j
  where r.id = j.run_id and j.status = 'dead_letter'
    and j.last_error_code in ('WORKER_LEASE_EXHAUSTED','LIVE_RETRY_WINDOW_EXPIRED')
    and r.status = 'running';

  return query
  with candidates as (
    select j.id from public.execution_jobs j
    where j.cancel_requested_at is null
      and (
        (j.status in ('queued','retry_wait','waiting') and j.available_at <= now())
        or (j.status = 'running' and j.lease_until < now())
      )
      and (j.status = 'waiting' or j.attempts < j.max_attempts)
      and not (j.execution_mode = 'live' and j.max_attempts > 1
        and j.created_at < now() - interval '20 hours')
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

create or replace function public.finish_execution_job(
  p_job_id uuid, p_lease_token uuid, p_succeeded boolean,
  p_error_code text default null, p_error_step_id text default null,
  p_error_message text default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  job_row public.execution_jobs%rowtype;
  safe_code text;
  safe_step_id text;
  retryable boolean;
  delay_seconds integer;
begin
  select * into job_row from public.execution_jobs
  where id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_until > now()
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
  retryable := safe_code in (
    'EMAIL_RATE_LIMITED','EMAIL_PROVIDER_TRANSIENT_FAILURE','EMAIL_IDEMPOTENCY_IN_PROGRESS',
    'GEMINI_RATE_LIMITED','GEMINI_PROVIDER_TRANSIENT_FAILURE',
    'PROVIDER_RATE_LIMITED','PROVIDER_TRANSIENT_FAILURE'
  );

  if job_row.execution_mode='live' then
    safe_step_id := case when p_error_step_id ~ '^[a-zA-Z0-9_-]{1,64}$' then p_error_step_id else 'workflow' end;
    insert into public.execution_error_events(
      workspace_id,workflow_id,workflow_run_id,job_id,step_id,attempt,error_code,safe_message
    ) values(
      job_row.workspace_id,job_row.workflow_id,job_row.run_id,job_row.id,safe_step_id,
      greatest(1,least(20,job_row.attempts)),safe_code,left(coalesce(p_error_message,safe_code),2000)
    ) on conflict(job_id,step_id,attempt) do nothing;
  end if;

  if job_row.attempts >= job_row.max_attempts
     or not retryable
     or (job_row.execution_mode='live' and job_row.max_attempts > 1
       and job_row.created_at < now() - interval '20 hours') then
    insert into public.execution_dead_letters
      (original_job_id,workspace_id,workflow_id,run_id,idempotency_key,attempts,error_code,payload)
    values(job_row.id,job_row.workspace_id,job_row.workflow_id,job_row.run_id,
      job_row.idempotency_key,job_row.attempts,
      case when retryable and job_row.execution_mode='live' and job_row.max_attempts > 1
        and job_row.created_at < now() - interval '20 hours'
        then 'LIVE_RETRY_WINDOW_EXPIRED' else safe_code end,
      job_row.payload)
    on conflict(original_job_id) do nothing;
    update public.execution_jobs set status='dead_letter',completed_at=now(),
      lease_token=null,lease_until=null,
      last_error_code=case when retryable and job_row.execution_mode='live' and job_row.max_attempts > 1
        and job_row.created_at < now() - interval '20 hours'
        then 'LIVE_RETRY_WINDOW_EXPIRED' else safe_code end
      where id=p_job_id;
    update public.workflow_runs set status='failed',completed_at=now(),
      error_message='Execution moved to dead-letter queue (' ||
        case when retryable and job_row.execution_mode='live' and job_row.max_attempts > 1
          and job_row.created_at < now() - interval '20 hours'
          then 'LIVE_RETRY_WINDOW_EXPIRED' else safe_code end || ')'
      where id=job_row.run_id and status='running';
    return 'dead_letter';
  end if;

  delay_seconds := least(3600,(5 * pg_catalog.power(2,least(job_row.attempts-1,9)))::integer);
  update public.execution_jobs set status='retry_wait',
    available_at=now()+make_interval(secs=>delay_seconds),
    lease_token=null,lease_until=null,last_error_code=safe_code where id=p_job_id;
  return 'retry_wait';
end;
$$;
revoke all on function public.finish_execution_job(uuid,uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_execution_job(uuid,uuid,boolean,text,text,text) to service_role;

-- The service-role dispatcher is the only caller. It supplies max_attempts=3
-- only after the application has checked the workflow's retry-safe operation
-- allowlist; all other live paths continue to pass 1.
create or replace function public.dispatch_workflow_execution(
  p_workspace_id uuid, p_workflow_id uuid, p_workflow_version integer,
  p_created_by uuid, p_idempotency_key text, p_payload jsonb,
  p_max_attempts integer, p_execution_mode text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare existing_job public.execution_jobs%rowtype;
declare workflow_row public.workflows%rowtype;
declare new_run_id uuid;
declare new_job_id uuid;
declare effective_attempts integer;
declare event_source text;
begin
  event_source := p_payload->>'source';
  if p_workspace_id is null or p_workflow_id is null or p_workflow_version is null
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200
     or p_max_attempts is null or p_max_attempts not between 1 and 20
     or p_execution_mode is null or p_execution_mode not in ('dry_run', 'live')
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 16384
     or (p_created_by is null and not (
       event_source in ('webhook','schedule','error_trigger')
       and (event_source <> 'webhook' or p_payload->>'webhookVerified' = 'true')
     )) then
    raise exception using errcode = '22023', message = 'Invalid execution dispatch request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_idempotency_key, 0)
  );

  select * into existing_job from public.execution_jobs
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if found then
    if existing_job.workflow_id <> p_workflow_id or existing_job.execution_mode <> p_execution_mode then
      raise exception using errcode = '23505', message = 'Idempotency key already used for a different workflow or execution mode';
    end if;
    return jsonb_build_object('job_id', existing_job.id, 'run_id', existing_job.run_id, 'duplicate', true);
  end if;

  select w.* into workflow_row from public.workflows w
  where w.id = p_workflow_id and w.workspace_id = p_workspace_id
    and w.version = p_workflow_version and w.status = 'active'
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'Workflow is not active or version changed';
  end if;

  effective_attempts := case
    when p_execution_mode = 'live' then least(p_max_attempts, 3)
    else p_max_attempts
  end;

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
