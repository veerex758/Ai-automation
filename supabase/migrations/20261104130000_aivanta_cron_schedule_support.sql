-- Add timezone-aware cron schedules alongside the existing interval schedule mode.
alter table public.workflow_schedules
  add column if not exists cron_expression text,
  add column if not exists timezone text not null default 'UTC';

alter table public.workflow_schedules
  drop constraint if exists workflow_schedules_cron_expression_check,
  add constraint workflow_schedules_cron_expression_check
    check (cron_expression is null or length(cron_expression) between 9 and 100),
  drop constraint if exists workflow_schedules_timezone_check,
  add constraint workflow_schedules_timezone_check
    check (length(timezone) between 1 and 100);

grant insert (cron_expression, timezone)
  on public.workflow_schedules to authenticated;
grant update (cron_expression, timezone)
  on public.workflow_schedules to authenticated;

create or replace function public.finish_workflow_cron_schedule_claim(
  p_schedule_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_next_run_at timestamptz default null,
  p_error_code text default null
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  current_schedule public.workflow_schedules%rowtype;
  safe_error_code text;
  effective_succeeded boolean := coalesce(p_succeeded, false);
  existing_run record;
  expected_idempotency_key text;
begin
  select * into current_schedule
  from public.workflow_schedules
  where id = p_schedule_id and lease_token = p_lease_token and lease_until > now()
  for update;
  if not found or current_schedule.cron_expression is null then return false; end if;

  expected_idempotency_key := current_schedule.id::text || ':' ||
    pg_catalog.to_char(current_schedule.next_run_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

  if not effective_succeeded then
    select r.id, r.workflow_id, r.workflow_version, r.mode, r.status
      into existing_run
      from public.workflow_runs r where r.idempotency_key = expected_idempotency_key;
    if found then
      if existing_run.workflow_id <> current_schedule.workflow_id
         or existing_run.mode <> 'dry_run' or existing_run.status <> 'succeeded' then
        raise exception using errcode = '23505', message = 'Scheduled run idempotency conflict';
      end if;
      effective_succeeded := true;
    end if;
  end if;

  safe_error_code := case when p_error_code ~ '^[A-Z0-9_]{1,64}$' then p_error_code else 'SCHEDULED_RUN_FAILED' end;
  if effective_succeeded then
    if p_next_run_at is null or p_next_run_at <= now() then
      raise exception using errcode = '22023', message = 'Cron next run must be in the future';
    end if;
    update public.workflow_schedules
    set last_run_at = current_schedule.next_run_at,
        next_run_at = p_next_run_at,
        failure_count = 0, last_error_code = null,
        lease_token = null, lease_until = null
    where id = p_schedule_id;
  else
    update public.workflow_schedules
    set failure_count = failure_count + 1,
        last_error_code = safe_error_code,
        next_run_at = now() + make_interval(mins => least(60, 5 * power(2, least(failure_count, 4))::integer)),
        lease_token = null, lease_until = null
    where id = p_schedule_id;
  end if;
  return true;
end;
$$;
revoke all on function public.finish_workflow_cron_schedule_claim(uuid,uuid,boolean,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.finish_workflow_cron_schedule_claim(uuid,uuid,boolean,timestamptz,text)
  to service_role;


-- The scheduler can now claim both legacy schedule triggers and registry-backed
-- Schedule/Cron trigger steps. Registry schedules require a persisted cron rule.
create or replace function public.claim_due_workflow_schedules(
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns table (
  schedule_id uuid, workflow_id uuid, workspace_id uuid, interval_minutes integer,
  scheduled_for timestamptz, lease_token uuid, workflow_version integer, definition jsonb
)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 50 or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception using errcode = '22023', message = 'Invalid claim parameters';
  end if;
  return query
  with due as (
    select s.id
    from public.workflow_schedules s
    join public.workflows w on w.id = s.workflow_id and w.workspace_id = s.workspace_id
    where s.enabled = true and s.next_run_at <= now()
      and (s.lease_until is null or s.lease_until <= now())
      and w.status = 'active'
      and (
        (jsonb_typeof(w.definition->'nodes') = 'array'
          and w.definition->'nodes'->0->'settings'->>'event' = 'schedule')
        or
        (s.cron_expression is not null
          and w.definition->>'format' = 'aivanta-registry-v1'
          and jsonb_typeof(w.definition->'steps') = 'array'
          and w.definition->'steps'->0->>'kind' = 'trigger'
          and w.definition->'steps'->0->>'nodeId' = 'schedule'
          and w.definition->'steps'->0->>'operationId' = 'scheduled')
      )
    order by s.next_run_at asc, s.id asc
    for update of s skip locked
    limit p_limit
  ), claimed as (
    update public.workflow_schedules s
    set lease_token = gen_random_uuid(),
        lease_until = now() + make_interval(secs => p_lease_seconds)
    from due where s.id = due.id
    returning s.id, s.workflow_id, s.workspace_id, s.interval_minutes, s.next_run_at, s.lease_token
  )
  select c.id, c.workflow_id, c.workspace_id, c.interval_minutes,
         c.next_run_at, c.lease_token, w.version, w.definition
  from claimed c
  join public.workflows w on w.id = c.workflow_id and w.workspace_id = c.workspace_id;
end;
$$;
revoke all on function public.claim_due_workflow_schedules(integer,integer) from public, anon, authenticated;
grant execute on function public.claim_due_workflow_schedules(integer,integer) to service_role;
