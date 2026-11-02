-- Durable execution queue foundation for Aivanta.
-- Queue rows and checkpoints are server-owned. Client roles receive no table access.
create table if not exists public.execution_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  workflow_version integer not null check (workflow_version > 0),
  workflow_definition jsonb not null check (jsonb_typeof(workflow_definition) = 'object' and octet_length(workflow_definition::text) <= 65536),
  job_type text not null default 'workflow_execution' check (job_type = 'workflow_execution'),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  status text not null default 'queued' check (status in ('queued','running','retry_wait','succeeded','dead_letter')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  worker_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint execution_jobs_workspace_id_idempotency_key unique (workspace_id, idempotency_key),
  constraint execution_jobs_lease_state check (
    (status = 'running' and lease_token is not null and lease_until is not null)
    or (status <> 'running' and lease_token is null and lease_until is null)
  )
);

create index if not exists execution_jobs_dispatch_idx
  on public.execution_jobs (available_at, created_at)
  where status in ('queued','retry_wait');
create index if not exists execution_jobs_expired_lease_idx
  on public.execution_jobs (lease_until)
  where status = 'running';
create index if not exists execution_jobs_run_idx on public.execution_jobs (run_id);

create table if not exists public.execution_checkpoints (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.execution_jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  step_id text not null check (length(step_id) between 1 and 64),
  step_position integer not null check (step_position > 0),
  status text not null check (status in ('started','succeeded','failed','skipped')),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object' and octet_length(input::text) <= 16384),
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object' and octet_length(output::text) <= 16384),
  attempt integer not null default 1 check (attempt > 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (job_id, step_id)
);
create index if not exists execution_checkpoints_workspace_job_idx
  on public.execution_checkpoints (workspace_id, job_id, step_position);

create table if not exists public.execution_dead_letters (
  id uuid primary key default gen_random_uuid(),
  original_job_id uuid not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  idempotency_key text not null,
  attempts integer not null,
  error_code text not null,
  payload jsonb not null default '{}'::jsonb,
  failed_at timestamptz not null default now(),
  replayed_at timestamptz
);
create index if not exists execution_dead_letters_workspace_failed_idx
  on public.execution_dead_letters (workspace_id, failed_at desc);

alter table public.execution_jobs enable row level security;
alter table public.execution_checkpoints enable row level security;
alter table public.execution_dead_letters enable row level security;
revoke all on public.execution_jobs, public.execution_checkpoints, public.execution_dead_letters from public, anon, authenticated;
grant all on public.execution_jobs, public.execution_checkpoints, public.execution_dead_letters to service_role;

create or replace function public.enqueue_execution_job(
  p_workspace_id uuid, p_workflow_id uuid, p_run_id uuid,
  p_idempotency_key text, p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
declare workflow_row public.workflows%rowtype;
declare run_row public.workflow_runs%rowtype;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200
     or p_max_attempts not between 1 and 20
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 16384 then
    raise exception using errcode = '22023', message = 'Invalid execution job request';
  end if;
  select * into workflow_row from public.workflows w
  where w.id = p_workflow_id and w.workspace_id = p_workspace_id
  for share;
  select * into run_row from public.workflow_runs r
  where r.id = p_run_id and r.workflow_id = p_workflow_id
    and r.workspace_id = p_workspace_id and r.status = 'running'
  for share;
  if not found or workflow_row.id is null or run_row.workflow_version <> workflow_row.version then
    raise exception using errcode = '22023', message = 'Execution job ownership or version mismatch';
  end if;
  insert into public.execution_jobs
    (workspace_id, workflow_id, run_id, workflow_version, workflow_definition, idempotency_key, payload, max_attempts)
  values (p_workspace_id, p_workflow_id, p_run_id, run_row.workflow_version, workflow_row.definition,
    p_idempotency_key, p_payload, p_max_attempts)
  on conflict (workspace_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.enqueue_execution_job(uuid,uuid,uuid,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.enqueue_execution_job(uuid,uuid,uuid,text,jsonb,integer) to service_role;

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

  -- A worker may disappear on its final allowed attempt. Sweep those expired
  -- leases into the dead-letter table before selecting new work, otherwise
  -- they would remain running forever and never be claimable again.
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
    where ((j.status in ('queued','retry_wait') and j.available_at <= now())
       or (j.status = 'running' and j.lease_until < now()))
      and j.attempts < j.max_attempts
    order by j.available_at, j.created_at
    for update skip locked
    limit p_limit
  )
  update public.execution_jobs j
  set status = 'running', attempts = j.attempts + 1,
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

create or replace function public.heartbeat_execution_job(
  p_job_id uuid, p_lease_token uuid, p_lease_seconds integer default 120
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare affected integer;
begin
  if p_lease_seconds not between 15 and 600 then
    raise exception using errcode = '22023', message = 'Invalid lease duration';
  end if;
  update public.execution_jobs
  set lease_until = now() + make_interval(secs => p_lease_seconds)
  where id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_until > now();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.heartbeat_execution_job(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.heartbeat_execution_job(uuid,uuid,integer) to service_role;

create or replace function public.checkpoint_execution_step(
  p_job_id uuid, p_lease_token uuid, p_step_id text, p_position integer,
  p_status text, p_input jsonb default '{}'::jsonb, p_output jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare result_id uuid;
declare job_workspace uuid;
begin
  select workspace_id into job_workspace from public.execution_jobs
  where id = p_job_id and status = 'running' and lease_token = p_lease_token
    and lease_until > now() for update;
  if not found then raise exception using errcode = 'P0002', message = 'Execution lease lost'; end if;
  if p_step_id is null or length(p_step_id) not between 1 and 64
     or p_position < 1 or p_status not in ('started','succeeded','failed','skipped')
     or p_input is null or jsonb_typeof(p_input) <> 'object'
     or p_output is null or jsonb_typeof(p_output) <> 'object'
     or octet_length(p_input::text) > 16384 or octet_length(p_output::text) > 16384 then
    raise exception using errcode = '22023', message = 'Invalid execution checkpoint';
  end if;
  insert into public.execution_checkpoints
    (job_id, workspace_id, step_id, step_position, status, input, output, completed_at)
  values (p_job_id, job_workspace, p_step_id, p_position, p_status, p_input, p_output,
    case when p_status = 'started' then null else now() end)
  on conflict (job_id, step_id) do update
    set status = excluded.status, input = excluded.input, output = excluded.output,
        attempt = execution_checkpoints.attempt + 1,
        started_at = case when excluded.status = 'started' then now() else public.execution_checkpoints.started_at end,
        completed_at = excluded.completed_at
  returning id into result_id;
  return result_id;
end;
$$;
revoke all on function public.checkpoint_execution_step(uuid,uuid,text,integer,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.checkpoint_execution_step(uuid,uuid,text,integer,text,jsonb,jsonb) to service_role;

create or replace function public.finish_execution_job(
  p_job_id uuid, p_lease_token uuid, p_succeeded boolean, p_error_code text default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare job_row public.execution_jobs%rowtype;
declare safe_code text;
declare delay_seconds integer;
begin
  select * into job_row from public.execution_jobs
  where id = p_job_id and status = 'running'
    and lease_token = p_lease_token and lease_until > now()
  for update;
  if not found then return 'lease_lost'; end if;
  if coalesce(p_succeeded,false) then
    update public.execution_jobs set status='succeeded', completed_at=now(),
      lease_token=null, lease_until=null, last_error_code=null where id=p_job_id;
    -- Finalize the run in the same transaction and only after the lease check.
    update public.workflow_runs set status='succeeded', completed_at=now(),
      duration_ms=least(600000, greatest(0, (extract(epoch from (now() - started_at)) * 1000)::integer))
      where id=job_row.run_id and status='running';
    return 'succeeded';
  end if;
  safe_code := case when p_error_code ~ '^[A-Z0-9_]{1,64}$' then p_error_code else 'EXECUTION_FAILED' end;
  if job_row.attempts >= job_row.max_attempts then
    insert into public.execution_dead_letters
      (original_job_id, workspace_id, workflow_id, run_id, idempotency_key, attempts, error_code, payload)
    values (job_row.id, job_row.workspace_id, job_row.workflow_id, job_row.run_id,
      job_row.idempotency_key, job_row.attempts, safe_code, job_row.payload)
    on conflict (original_job_id) do nothing;
    update public.execution_jobs set status='dead_letter', completed_at=now(),
      lease_token=null, lease_until=null, last_error_code=safe_code where id=p_job_id;
    update public.workflow_runs set status='failed', completed_at=now(),
      error_message='Execution moved to dead-letter queue (' || safe_code || ')'
      where id=job_row.run_id and status='running';
    return 'dead_letter';
  end if;
  delay_seconds := least(3600, (5 * pg_catalog.power(2, least(job_row.attempts - 1, 9)))::integer);
  update public.execution_jobs set status='retry_wait',
    available_at=now() + make_interval(secs => delay_seconds),
    lease_token=null, lease_until=null, last_error_code=safe_code where id=p_job_id;
  return 'retry_wait';
end;
$$;
revoke all on function public.finish_execution_job(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.finish_execution_job(uuid,uuid,boolean,text) to service_role;


-- Atomically create the workflow run and its queue job. The advisory lock
-- serializes concurrent deliveries for the same workspace/idempotency key.
create or replace function public.dispatch_workflow_execution(
  p_workspace_id uuid, p_workflow_id uuid, p_workflow_version integer,
  p_created_by uuid, p_idempotency_key text, p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare existing_job public.execution_jobs%rowtype;
declare workflow_row public.workflows%rowtype;
declare new_run_id uuid;
declare new_job_id uuid;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200
     or p_max_attempts not between 1 and 20
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
  -- Lock and snapshot the exact workflow version inside this dispatch transaction.
  -- Later edits cannot change what an already-queued job will execute.
  select w.* into workflow_row from public.workflows w
  where w.id = p_workflow_id and w.workspace_id = p_workspace_id
    and w.version = p_workflow_version and w.status = 'active'
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'Workflow is not active or version changed';
  end if;
  insert into public.workflow_runs (
    workspace_id, workflow_id, workflow_version, mode, status, created_by,
    idempotency_key, started_at, completed_at, duration_ms
  ) values (
    p_workspace_id, p_workflow_id, p_workflow_version, 'dry_run', 'running',
    p_created_by, p_idempotency_key, now(), null, 0
  ) returning id into new_run_id;
  insert into public.execution_jobs (
    workspace_id, workflow_id, run_id, workflow_version, workflow_definition,
    idempotency_key, payload, max_attempts
  ) values (
    p_workspace_id, p_workflow_id, new_run_id, workflow_row.version, workflow_row.definition,
    p_idempotency_key, p_payload, p_max_attempts
  ) returning id into new_job_id;
  return jsonb_build_object('job_id', new_job_id, 'run_id', new_run_id, 'duplicate', false);
end;
$$;
revoke all on function public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer) to service_role;

