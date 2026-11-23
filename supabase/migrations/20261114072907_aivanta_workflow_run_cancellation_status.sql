-- Keep workflow-run terminal states aligned with durable execution cancellation.
-- Existing run records are preserved; only the accepted status domain changes.
alter table public.workflow_runs
  drop constraint if exists workflow_runs_status_check;

alter table public.workflow_runs
  add constraint workflow_runs_status_check
  check (status in ('running', 'succeeded', 'failed', 'cancelled'));
