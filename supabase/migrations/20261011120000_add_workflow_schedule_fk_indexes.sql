-- Phase 11 performance follow-up.
-- Cover foreign-key lookups and workspace-scoped schedule queries.
-- Apply only through the reviewed Supabase migration workflow; do not run ad hoc in production.

CREATE INDEX IF NOT EXISTS workflow_schedules_created_by_idx
  ON public.workflow_schedules (created_by);

CREATE INDEX IF NOT EXISTS workflow_schedules_workspace_id_idx
  ON public.workflow_schedules (workspace_id);
