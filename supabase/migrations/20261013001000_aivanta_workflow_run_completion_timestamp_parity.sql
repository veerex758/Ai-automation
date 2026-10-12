-- Keep staging aligned with the canonical live-run lifecycle: a run has no
-- completion timestamp until execution has finished.
-- Safe and idempotent; this only relaxes NOT NULL on the isolated staging DB.
alter table public.workflow_runs
  alter column completed_at drop not null;
