-- Restore least-privilege column grants after the invoker-RPC hardening.
-- RLS controls which rows may be changed; column grants additionally prevent
-- clients from reassigning ownership/workspace, forging run attribution, or
-- editing scheduler lease state directly.

REVOKE UPDATE ON TABLE
  public.workspaces,
  public.workspace_members,
  public.workflows,
  public.workflow_runs,
  public.workflow_schedules
FROM PUBLIC, anon, authenticated;

-- Workspace owners can rename a workspace, but cannot rewrite its owner.
GRANT UPDATE (name) ON TABLE public.workspaces TO authenticated;

-- Workspace admins can change a member's role, but cannot move/reassign members.
GRANT UPDATE (role) ON TABLE public.workspace_members TO authenticated;

-- Definition/version columns are needed by the validated invoker RPC. The
-- workflow guard trigger rejects direct edits unless the RPC sets its local flag.
GRANT UPDATE (name, description, status, definition, version)
  ON TABLE public.workflows TO authenticated;

-- RLS limits this path to the creator's own in-progress live run. Do not expose
-- attribution, workflow linkage, mode, or idempotency-key updates.
GRANT UPDATE (status, completed_at, duration_ms, error_message)
  ON TABLE public.workflow_runs TO authenticated;

-- Reassert scheduler configuration-only writes. Worker lease/health fields are
-- writable only through the restricted service-role dispatcher functions.
REVOKE INSERT, UPDATE ON TABLE public.workflow_schedules
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (workflow_id, workspace_id, interval_minutes, enabled, next_run_at)
  ON TABLE public.workflow_schedules TO authenticated;
GRANT UPDATE (interval_minutes, enabled, next_run_at)
  ON TABLE public.workflow_schedules TO authenticated;
