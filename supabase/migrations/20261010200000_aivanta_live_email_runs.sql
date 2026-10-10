-- Enable tightly gated live email runs with idempotency and explicit run states.
alter table public.workflow_runs
  add column if not exists idempotency_key text;

create unique index if not exists workflow_runs_idempotency_key_uidx
  on public.workflow_runs (idempotency_key)
  where idempotency_key is not null;

alter table public.workflow_runs drop constraint if exists workflow_runs_mode_check;
alter table public.workflow_runs
  add constraint workflow_runs_mode_check check (mode = any (array['dry_run'::text, 'live'::text]));

alter table public.workflow_runs drop constraint if exists workflow_runs_status_check;
alter table public.workflow_runs
  add constraint workflow_runs_status_check check (status = any (array['running'::text, 'succeeded'::text, 'failed'::text]));

alter table public.workflow_run_steps drop constraint if exists workflow_run_steps_status_check;
alter table public.workflow_run_steps
  add constraint workflow_run_steps_status_check check (status = any (array['simulated'::text, 'skipped'::text, 'executed'::text, 'failed'::text]));

drop policy if exists "members can create dry-run records" on public.workflow_runs;
create policy "members can create workflow run records"
  on public.workflow_runs
  for insert
  to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and created_by = (select auth.uid())
    and (
      (mode = 'dry_run' and status in ('succeeded', 'failed'))
      or (mode = 'live' and status = 'running' and idempotency_key is not null)
    )
    and exists (
      select 1 from public.workflows w
      where w.id = workflow_runs.workflow_id
        and w.workspace_id = workflow_runs.workspace_id
    )
  );

drop policy if exists "members can finalize their live workflow runs" on public.workflow_runs;
create policy "members can finalize their live workflow runs"
  on public.workflow_runs
  for update
  to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and created_by = (select auth.uid())
    and mode = 'live'
    and status = 'running'
  )
  with check (
    private.is_workspace_member(workspace_id)
    and created_by = (select auth.uid())
    and mode = 'live'
    and status in ('succeeded', 'failed')
  );

