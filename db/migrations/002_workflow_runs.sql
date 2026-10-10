-- Aivanta workflow run history.
-- Step 5 starts with dry-runs only: this schema does not enable external side effects.

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  workflow_version integer not null check (workflow_version > 0),
  mode text not null default 'dry_run' check (mode = 'dry_run'),
  status text not null check (status in ('succeeded', 'failed')),
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  constraint workflow_runs_completion_order check (completed_at >= started_at)
);

create index if not exists workflow_runs_workspace_created_idx
  on public.workflow_runs (workspace_id, created_at desc);
create index if not exists workflow_runs_workflow_created_idx
  on public.workflow_runs (workflow_id, created_at desc);

create table if not exists public.workflow_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  step_id text not null check (length(step_id) between 1 and 64),
  position integer not null check (position > 0),
  step_type text not null check (step_type in ('trigger', 'action', 'condition')),
  title varchar(80) not null,
  status text not null check (status in ('simulated', 'skipped', 'failed')),
  result jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  constraint workflow_run_steps_unique_id unique (run_id, step_id),
  constraint workflow_run_steps_completion_order check (completed_at >= started_at)
);

create index if not exists workflow_run_steps_run_position_idx
  on public.workflow_run_steps (run_id, position);
create index if not exists workflow_run_steps_workspace_idx
  on public.workflow_run_steps (workspace_id, run_id);

alter table public.workflow_runs enable row level security;
alter table public.workflow_run_steps enable row level security;

drop policy if exists "members can read workflow runs" on public.workflow_runs;
create policy "members can read workflow runs"
  on public.workflow_runs for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists "members can create dry-run records" on public.workflow_runs;
create policy "members can create dry-run records"
  on public.workflow_runs for insert to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and created_by = (select auth.uid())
    and mode = 'dry_run'
    and exists (
      select 1
      from public.workflows w
      where w.id = workflow_id
        and w.workspace_id = workflow_runs.workspace_id
    )
  );

drop policy if exists "members can read workflow run steps" on public.workflow_run_steps;
create policy "members can read workflow run steps"
  on public.workflow_run_steps for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists "members can create workflow run steps" on public.workflow_run_steps;
create policy "members can create workflow run steps"
  on public.workflow_run_steps for insert to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and exists (
      select 1
      from public.workflow_runs r
      where r.id = run_id
        and r.workspace_id = workflow_run_steps.workspace_id
        and r.workflow_id is not null
    )
  );

grant select, insert on public.workflow_runs to authenticated;
grant select, insert on public.workflow_run_steps to authenticated;
revoke all on public.workflow_runs from anon;
revoke all on public.workflow_run_steps from anon;
