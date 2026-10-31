-- Match the live staging contract: running workflow runs may have no completion time.
-- Keep the completion-order check valid for completed runs while allowing NULL during execution.
alter table public.workflow_runs
  alter column completed_at drop not null;

alter table public.workflow_runs
  drop constraint if exists workflow_runs_completion_order;

alter table public.workflow_runs
  add constraint workflow_runs_completion_order
  check (completed_at is null or completed_at >= started_at);
