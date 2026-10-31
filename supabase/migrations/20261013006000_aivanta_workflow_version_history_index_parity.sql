-- Restore the workflow-version history lookup index present in the canonical
-- foundation migration but missing from the live staging catalog.
create index if not exists workflow_versions_workflow_created_idx
  on public.workflow_versions (workflow_id, created_at desc);
