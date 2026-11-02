-- Keep workspace admins able to revoke an already-granted permission after the
-- package is quarantined or retired. The permission value is immutable through
-- authenticated column grants and was validated when the grant was created.
drop policy if exists workspace_node_permission_grants_admin_update
  on public.workspace_node_permission_grants;

create policy workspace_node_permission_grants_admin_update
  on public.workspace_node_permission_grants for update to authenticated
  using (private.is_workspace_admin(workspace_id) and status = 'active')
  with check (
    private.is_workspace_admin(workspace_id)
    and status = 'revoked'
    and revoked_at is not null
    and revoked_by = (select auth.uid())
    and exists (
      select 1
      from public.workspace_node_installations i
      where i.id = installation_id
        and i.workspace_id = workspace_node_permission_grants.workspace_id
    )
  );
