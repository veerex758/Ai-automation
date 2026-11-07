-- Customer workspace members may edit only installation configuration.
-- Lifecycle, workflow linkage, version pinning and activation remain server-controlled.
revoke update on public.marketplace_installations from authenticated;
grant update(configuration) on public.marketplace_installations to authenticated;

-- Keep the membership-scoped RLS policy as defense in depth for configuration writes.
drop policy if exists marketplace_installations_workspace_update on public.marketplace_installations;
create policy marketplace_installations_workspace_update on public.marketplace_installations
 for update to authenticated
 using (private.is_workspace_member(workspace_id))
 with check (private.is_workspace_member(workspace_id));
