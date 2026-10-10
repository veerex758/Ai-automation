create index if not exists workflow_runs_created_by_idx
  on public.workflow_runs (created_by)
  where created_by is not null;
