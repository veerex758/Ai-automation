-- Add covering indexes for foreign keys identified by the Supabase performance advisor.
-- Additive only; these indexes do not alter rows, constraints, RLS, or grants.

create index if not exists google_connections_connected_by_idx
  on public.google_connections (connected_by);

create index if not exists webhook_endpoints_workflow_workspace_idx
  on public.webhook_endpoints (workflow_id, workspace_id);

create index if not exists webhook_endpoints_created_by_idx
  on public.webhook_endpoints (created_by);

create index if not exists webhook_endpoints_workspace_id_idx
  on public.webhook_endpoints (workspace_id);

create index if not exists workspace_integrations_created_by_idx
  on public.workspace_integrations (created_by);
