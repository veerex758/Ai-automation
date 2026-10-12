-- Tighten workflow version attribution in the isolated staging database.
-- A member may only create a version attributed to their authenticated identity.
drop policy if exists workflow_versions_insert_member on public.workflow_versions;
create policy workflow_versions_insert_member
  on public.workflow_versions
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.workflows w
      where w.id = workflow_versions.workflow_id
        and private.is_workspace_member(w.workspace_id)
    )
  );
