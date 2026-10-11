-- Persist bounded interval schedules and claim due work atomically.
-- This is scheduling infrastructure only; it does not execute workflows or external actions.
create table if not exists public.workflow_schedules (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null unique references public.workflows(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  interval_minutes integer not null check (interval_minutes between 15 and 10080),
  enabled boolean not null default false,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_schedules_lease_pair_check check ((lease_token is null) = (lease_until is null)),
  constraint workflow_schedules_workspace_workflow_unique unique (workflow_id, workspace_id)
);

create index if not exists workflow_schedules_due_idx
  on public.workflow_schedules (next_run_at)
  where enabled = true;

drop trigger if exists workflow_schedules_set_updated_at on public.workflow_schedules;
create trigger workflow_schedules_set_updated_at
  before update on public.workflow_schedules
  for each row execute function public.set_updated_at();

alter table public.workflow_schedules enable row level security;

create policy "workspace members can read workflow schedules"
  on public.workflow_schedules for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "workspace members can create workflow schedules"
  on public.workflow_schedules for insert to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.workflows w
      where w.id = workflow_schedules.workflow_id
        and w.workspace_id = workflow_schedules.workspace_id
    )
  );

create policy "workspace members can update workflow schedules"
  on public.workflow_schedules for update to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (
    private.is_workspace_member(workspace_id)
    and exists (
      select 1 from public.workflows w
      where w.id = workflow_schedules.workflow_id
        and w.workspace_id = workflow_schedules.workspace_id
    )
  );

revoke all on public.workflow_schedules from anon, public;
revoke insert, update on public.workflow_schedules from authenticated;
grant select on public.workflow_schedules to authenticated;
-- Authenticated users may edit only schedule configuration, never worker lease state.
grant insert (workflow_id, workspace_id, interval_minutes, enabled, next_run_at)
  on public.workflow_schedules to authenticated;
grant update (interval_minutes, enabled, next_run_at)
  on public.workflow_schedules to authenticated;

-- Claims a small batch atomically. The schedule remains due until the worker
-- acknowledges completion; a crashed worker's lease becomes claimable again.
create or replace function public.claim_due_workflow_schedules(
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns table (
  schedule_id uuid,
  workflow_id uuid,
  workspace_id uuid,
  interval_minutes integer,
  scheduled_for timestamptz,
  lease_token uuid,
  workflow_version integer,
  definition jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception using errcode = '22023', message = 'Invalid claim batch size';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception using errcode = '22023', message = 'Invalid lease duration';
  end if;

  return query
  with due as (
    select s.id
    from public.workflow_schedules s
    join public.workflows w on w.id = s.workflow_id and w.workspace_id = s.workspace_id
    where s.enabled = true
      and s.next_run_at <= now()
      and (s.lease_until is null or s.lease_until <= now())
      and w.status = 'active'
      and jsonb_typeof(w.definition->'nodes') = 'array'
      and w.definition->'nodes'->0->'settings'->>'event' = 'schedule'
    order by s.next_run_at asc, s.id asc
    for update of s skip locked
    limit p_limit
  ),
  claimed as (
    update public.workflow_schedules s
    set lease_token = gen_random_uuid(),
        lease_until = now() + make_interval(secs => p_lease_seconds)
    from due
    where s.id = due.id
    returning s.id, s.workflow_id, s.workspace_id, s.interval_minutes,
              s.next_run_at, s.lease_token
  )
  select c.id, c.workflow_id, c.workspace_id, c.interval_minutes,
         c.next_run_at, c.lease_token, w.version, w.definition
  from claimed c
  join public.workflows w on w.id = c.workflow_id and w.workspace_id = c.workspace_id;
end;
$$;

-- Long-running workers may renew only their own unexpired lease. Once expired,
-- a worker must not resurrect its lease or finalize the claim.
create or replace function public.renew_workflow_schedule_claim(
  p_schedule_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception using errcode = '22023', message = 'Invalid lease duration';
  end if;

  update public.workflow_schedules
  set lease_until = now() + make_interval(secs => p_lease_seconds)
  where id = p_schedule_id
    and lease_token = p_lease_token
    and lease_until > now();

  return found;
end;
$$;

-- Workers must present the current lease token. Success advances the schedule;
-- failure applies bounded exponential backoff and records only a safe error code.
create or replace function public.finish_workflow_schedule_claim(
  p_schedule_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_schedule public.workflow_schedules%rowtype;
  safe_error_code text;
begin
  select * into current_schedule
  from public.workflow_schedules
  where id = p_schedule_id
    and lease_token = p_lease_token
    and lease_until > now()
  for update;

  if not found then
    return false;
  end if;

  safe_error_code := case
    when p_error_code ~ '^[A-Z0-9_]{1,64}$' then p_error_code
    else 'SCHEDULED_RUN_FAILED'
  end;

  if p_succeeded then
    update public.workflow_schedules
    set last_run_at = current_schedule.next_run_at,
        next_run_at = greatest(
          current_schedule.next_run_at + make_interval(mins => current_schedule.interval_minutes),
          now() + make_interval(mins => current_schedule.interval_minutes)
        ),
        failure_count = 0,
        last_error_code = null,
        lease_token = null,
        lease_until = null
    where id = p_schedule_id;
  else
    update public.workflow_schedules
    set failure_count = failure_count + 1,
        last_error_code = safe_error_code,
        next_run_at = now() + make_interval(mins => least(60, 5 * power(2, least(failure_count, 4))::integer)),
        lease_token = null,
        lease_until = null
    where id = p_schedule_id;
  end if;

  return true;
end;
$$;

revoke all on function public.claim_due_workflow_schedules(integer, integer) from public, anon, authenticated;
revoke all on function public.finish_workflow_schedule_claim(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.renew_workflow_schedule_claim(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_due_workflow_schedules(integer, integer) to service_role;
grant execute on function public.finish_workflow_schedule_claim(uuid, uuid, boolean, text) to service_role;
grant execute on function public.renew_workflow_schedule_claim(uuid, uuid, integer) to service_role;
