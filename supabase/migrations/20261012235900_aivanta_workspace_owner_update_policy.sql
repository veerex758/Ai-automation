-- Keep workspace-level metadata changes owner-only, matching the canonical policy.
drop policy if exists workspaces_update_admin on public.workspaces;
drop policy if exists workspaces_update_owner on public.workspaces;
create policy workspaces_update_owner
on public.workspaces
for update
to authenticated
using (private.is_workspace_owner(id))
with check (private.is_workspace_owner(id));
