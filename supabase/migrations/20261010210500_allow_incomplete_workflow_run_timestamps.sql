-- Running live runs have not completed yet, so completed_at must allow NULL.
alter table public.workflow_runs
  alter column completed_at drop not null;
