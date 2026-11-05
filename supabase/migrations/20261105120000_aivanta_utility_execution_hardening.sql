-- Shared utility execution primitives. Additive only; safe to roll back after workers stop.
create table if not exists public.execution_rate_limit_hits (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{32}$'),
  hit_at timestamptz not null default clock_timestamp()
);
create index if not exists execution_rate_limit_hits_lookup_idx
  on public.execution_rate_limit_hits(workspace_id,key_hash,hit_at);
create index if not exists execution_rate_limit_hits_expiry_idx
  on public.execution_rate_limit_hits(hit_at);
alter table public.execution_rate_limit_hits enable row level security;
revoke all on public.execution_rate_limit_hits from public,anon,authenticated;
grant all on public.execution_rate_limit_hits to service_role;

create or replace function public.consume_execution_rate_limit(
  p_workspace_id uuid,p_key text,p_limit integer,p_window_ms integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  key_digest text;
  current_count integer;
  oldest_hit timestamptz;
  allowed boolean;
  remaining integer;
  retry_ms integer;
  now_at timestamptz := clock_timestamp();
begin
  if p_workspace_id is null or p_key is null or length(p_key) not between 1 and 200
     or p_limit not between 1 and 10000 or p_window_ms not between 100 and 3600000 then
    raise exception using errcode='22023',message='Invalid rate limit request';
  end if;
  key_digest := md5(p_key);
  -- Opportunistically prune a bounded number of expired rows so one-off keys
  -- cannot grow the shared limiter table without limit.
  delete from public.execution_rate_limit_hits
  where ctid in (
    select ctid from public.execution_rate_limit_hits
    where hit_at <= now_at - interval '1 hour'
    order by hit_at
    limit 500
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text || ':' || key_digest,0));
  delete from public.execution_rate_limit_hits
    where workspace_id=p_workspace_id and key_hash=key_digest
      and hit_at <= now_at - (p_window_ms * interval '1 millisecond');
  select count(*)::integer,min(hit_at) into current_count,oldest_hit
    from public.execution_rate_limit_hits
    where workspace_id=p_workspace_id and key_hash=key_digest;
  allowed := current_count < p_limit;
  if allowed then
    insert into public.execution_rate_limit_hits(workspace_id,key_hash,hit_at) values(p_workspace_id,key_digest,now_at);
    remaining := greatest(0,p_limit-current_count-1);
    retry_ms := 0;
  else
    remaining := 0;
    retry_ms := greatest(0,ceil(extract(epoch from (oldest_hit + p_window_ms * interval '1 millisecond' - now_at))*1000)::integer);
  end if;
  return jsonb_build_object('allowed',allowed,'remaining',remaining,'retryAfterMs',retry_ms);
end;
$$;
revoke all on function public.consume_execution_rate_limit(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_execution_rate_limit(uuid,text,integer,integer) to service_role;

create table if not exists public.execution_error_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  job_id uuid not null references public.execution_jobs(id) on delete cascade,
  step_id text not null check(length(step_id) between 1 and 64),
  attempt integer not null check(attempt between 1 and 20),
  error_code text not null check(error_code ~ '^[A-Z0-9_]{1,64}$'),
  safe_message text not null check(length(safe_message) between 1 and 2000),
  dispatch_status text not null default 'pending' check(dispatch_status in ('pending','dispatched','dead_letter')),
  dispatch_attempts integer not null default 0 check(dispatch_attempts between 0 and 100),
  dispatch_error_code text,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  unique(job_id,step_id,attempt)
);
create index if not exists execution_error_events_workspace_created_idx
  on public.execution_error_events(workspace_id,created_at desc);
create index if not exists execution_error_events_pending_idx
  on public.execution_error_events(created_at)
  where dispatch_status = 'pending';
alter table public.execution_error_events enable row level security;
revoke all on public.execution_error_events from public,anon,authenticated;
grant all on public.execution_error_events to service_role;

create or replace function public.record_execution_error_event(
  p_job_id uuid,p_lease_token uuid,p_step_id text,p_error_code text,p_safe_message text,p_attempt integer
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  job_row public.execution_jobs%rowtype;
  event_id uuid;
  safe_code text;
begin
  select * into job_row from public.execution_jobs
    where id=p_job_id and status='running' and lease_token=p_lease_token and lease_until > now() for update;
  if not found then raise exception using errcode='22023',message='Execution lease is not valid'; end if;
  safe_code := case when p_error_code ~ '^[A-Z0-9_]{1,64}$' then p_error_code else 'NODE_EXECUTION_FAILED' end;
  if p_step_id is null or length(p_step_id) not between 1 and 64
     or p_attempt is null or p_attempt not between 1 and 20 then
    raise exception using errcode='22023',message='Invalid execution error event';
  end if;
  insert into public.execution_error_events(workspace_id,workflow_id,workflow_run_id,job_id,step_id,attempt,error_code,safe_message)
  values(job_row.workspace_id,job_row.workflow_id,job_row.run_id,p_job_id,p_step_id,p_attempt,safe_code,left(coalesce(p_safe_message,safe_code),2000))
  on conflict(job_id,step_id,attempt) do update set error_code=excluded.error_code
  returning id into event_id;
  return event_id;
end;
$$;
revoke all on function public.record_execution_error_event(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.record_execution_error_event(uuid,uuid,text,text,text,integer) to service_role;


-- Dispatch each persisted failure to active workflows whose first registry
-- step is the Error Trigger. The source job payload is checked by the worker
-- before this function is called to prevent recursive error-trigger chains.
create or replace function public.dispatch_execution_error_event(p_event_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  event_row public.execution_error_events%rowtype;
  source_job public.execution_jobs%rowtype;
  workflow_row public.workflows%rowtype;
  dispatched integer := 0;
  dispatch_result jsonb;
  event_input jsonb;
begin
  select * into event_row from public.execution_error_events where id = p_event_id for update;
  if not found then raise exception using errcode='P0002',message='Execution error event not found'; end if;
  if event_row.dispatch_status = 'dispatched' then return 0; end if;
  if event_row.dispatch_status = 'dead_letter' then return 0; end if;
  select * into source_job from public.execution_jobs where id = event_row.job_id;
  if not found then raise exception using errcode='P0002',message='Execution source job not found'; end if;
  if source_job.execution_mode <> 'live' or source_job.payload->>'source' = 'error_trigger' then
    update public.execution_error_events
      set dispatch_status='dispatched',dispatch_attempts=dispatch_attempts+1,
          dispatch_error_code=null,dispatched_at=now()
      where id=p_event_id;
    return 0;
  end if;

  event_input := jsonb_build_object(
    'eventId', event_row.id,
    'code', event_row.error_code,
    'message', event_row.safe_message,
    'workflowId', event_row.workflow_id,
    'workflowRunId', event_row.workflow_run_id,
    'executionId', event_row.job_id,
    'stepId', event_row.step_id,
    'attempt', event_row.attempt,
    'occurredAt', to_char(event_row.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  for workflow_row in
    select w.* from public.workflows w
    where w.workspace_id = event_row.workspace_id
      and w.status = 'active'
      and w.created_by is not null
      and w.id <> event_row.workflow_id
      and w.definition->>'format' = 'aivanta-registry-v1'
      and jsonb_typeof(w.definition->'steps') = 'array'
      and w.definition->'steps'->0->>'kind' = 'trigger'
      and w.definition->'steps'->0->>'nodeId' = 'error_trigger'
      and w.definition->'steps'->0->>'operationId' = 'capture'
  loop
    dispatch_result := public.dispatch_workflow_execution(
      workflow_row.workspace_id,
      workflow_row.id,
      workflow_row.version,
      workflow_row.created_by,
      'error:' || event_row.id::text || ':' || workflow_row.id::text,
      jsonb_build_object('source','error_trigger','input',event_input),
      1,
      'live'
    );
    if coalesce((dispatch_result->>'duplicate')::boolean,false) = false then
      dispatched := dispatched + 1;
    end if;
  end loop;
  update public.execution_error_events
    set dispatch_status='dispatched',dispatch_attempts=dispatch_attempts+1,
        dispatch_error_code=null,dispatched_at=now()
    where id=p_event_id;
  return dispatched;
end;
$$;
revoke all on function public.dispatch_execution_error_event(uuid) from public,anon,authenticated;
grant execute on function public.dispatch_execution_error_event(uuid) to service_role;


-- Retry pending Error Trigger deliveries independently of the failed source
-- workflow. Event persistence is committed before dispatch, so transient queue
-- failures cannot erase the original failure record.
create or replace function public.dispatch_pending_execution_error_events(p_limit integer default 25)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  event_id uuid;
  processed integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode='22023',message='Invalid error dispatch batch size';
  end if;
  for event_id in
    select id from public.execution_error_events
    where dispatch_status='pending'
    order by created_at
    limit p_limit
    for update skip locked
  loop
    begin
      perform public.dispatch_execution_error_event(event_id);
    exception when others then
      update public.execution_error_events
        set dispatch_attempts=dispatch_attempts+1,
            dispatch_status=case when dispatch_attempts+1 >= 20 then 'dead_letter' else 'pending' end,
            dispatch_error_code='ERROR_TRIGGER_DISPATCH_FAILED'
        where id=event_id;
    end;
    processed := processed + 1;
  end loop;
  return processed;
end;
$$;
revoke all on function public.dispatch_pending_execution_error_events(integer) from public,anon,authenticated;
grant execute on function public.dispatch_pending_execution_error_events(integer) to service_role;


-- Persisting a failure and fanning it out are one transaction. If enqueueing
-- any subscriber fails, the event insert rolls back and the worker retry can
-- safely attempt the operation again.
create or replace function public.record_and_dispatch_execution_error_event(
  p_job_id uuid,p_lease_token uuid,p_step_id text,p_error_code text,p_safe_message text,p_attempt integer
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  event_id uuid;
  source_mode text;
  source_payload jsonb;
begin
  select execution_mode,payload into source_mode,source_payload
  from public.execution_jobs
  where id = p_job_id and status = 'running' and lease_token = p_lease_token and lease_until > now();
  if not found then raise exception using errcode='22023',message='Execution lease is not valid'; end if;
  event_id := public.record_execution_error_event(
    p_job_id,p_lease_token,p_step_id,p_error_code,p_safe_message,p_attempt
  );
  if source_mode <> 'live' or source_payload->>'source' = 'error_trigger' then
    return 0;
  end if;
  return public.dispatch_execution_error_event(event_id);
end;
$$;
revoke all on function public.record_and_dispatch_execution_error_event(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.record_and_dispatch_execution_error_event(uuid,uuid,text,text,text,integer) to service_role;


-- A live workflow failure is journaled in the same transaction that finalizes
-- its job. This is the fallback if the in-run reporter could not persist the
-- event; the worker's next poll will dispatch pending events.
drop function if exists public.finish_execution_job(uuid,uuid,boolean,text);
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
