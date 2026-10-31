-- Keep direct table access explicit; row-level security remains the data boundary.
-- Applied and verified on the isolated Aivanta staging Supabase project.
REVOKE ALL PRIVILEGES ON TABLE
  public.workspaces,
  public.workspace_members,
  public.workflows,
  public.workflow_versions,
  public.audit_events,
  public.workflow_runs,
  public.workflow_run_steps,
  public.workflow_schedules
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workflows TO authenticated;
GRANT SELECT, INSERT ON TABLE public.workflow_versions TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.workflow_runs TO authenticated;
GRANT SELECT, INSERT ON TABLE public.workflow_run_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.workflow_schedules TO authenticated;
