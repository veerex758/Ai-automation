-- Prevent workspace members from forging step history for another member's run.
drop policy if exists "members can create workflow run steps" on public.workflow_run_steps;
drop policy if exists "members can create their own workflow run steps" on public.workflow_run_steps;

create policy "members can create their own workflow run steps"
  on public.workflow_run_steps
  for insert
  to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and exists (
      select 1
      from public.workflow_runs r
      where r.id = workflow_run_steps.run_id
        and r.workspace_id = workflow_run_steps.workspace_id
        and r.workflow_id is not null
        and r.created_by = (select auth.uid())
        and (
          (r.mode = 'dry_run' and r.status in ('succeeded', 'failed')
            and workflow_run_steps.status in ('simulated', 'skipped', 'failed'))
          or
          (r.mode = 'live' and r.status = 'running'
            and workflow_run_steps.status in ('simulated', 'skipped', 'executed', 'failed'))
        )
    )
  );
