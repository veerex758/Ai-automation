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
