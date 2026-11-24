-- Persist the execution mode on each durable queue item.
-- Existing jobs default to dry-run; newly dispatched live jobs are explicit.
alter table public.execution_jobs
  add column if not exists execution_mode text not null default 'dry_run';

alter table public.execution_jobs
  drop constraint if exists execution_jobs_execution_mode_check;

alter table public.execution_jobs
  add constraint execution_jobs_execution_mode_check
  check (execution_mode in ('dry_run', 'live'));
