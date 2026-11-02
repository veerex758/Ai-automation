-- Harden node installation grants and keep workspace admins able to revoke an
-- already-granted permission after package quarantine. Permission values are
-- immutable through authenticated column grants and validated at grant time.
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

-- RLS does not protect TRUNCATE. Remove Supabase default grants from anonymous
-- and authenticated roles, then restore only the intended authenticated access.
revoke all on public.workspace_node_installations,
  public.workspace_node_permission_grants from public, anon, authenticated;

grant select, insert, update on public.workspace_node_installations,
  public.workspace_node_permission_grants to authenticated;

-- Authenticated users may update lifecycle fields only; no DELETE, TRUNCATE,
-- REFERENCES, or TRIGGER privilege is needed for workspace operations.
revoke update on public.workspace_node_installations from authenticated;
grant update (status, updated_at, disabled_at, uninstalled_at)
  on public.workspace_node_installations to authenticated;
revoke update on public.workspace_node_permission_grants from authenticated;
grant update (status, revoked_by, revoked_at, updated_at)
  on public.workspace_node_permission_grants to authenticated;
