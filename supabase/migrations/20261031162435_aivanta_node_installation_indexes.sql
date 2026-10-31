-- Cover new node-registry and workspace lifecycle foreign keys.
create index node_publishers_verified_by_idx
  on public.node_publishers(verified_by) where verified_by is not null;
create index node_packages_publisher_id_idx
  on public.node_packages(publisher_id);
create index node_package_versions_approved_by_idx
  on public.node_package_versions(approved_by) where approved_by is not null;
create index node_platform_audit_events_actor_user_id_idx
  on public.node_platform_audit_events(actor_user_id) where actor_user_id is not null;
create index workspace_node_installations_package_version_id_idx
  on public.workspace_node_installations(package_version_id);
create index workspace_node_installations_installed_by_idx
  on public.workspace_node_installations(installed_by);
create index workspace_node_permission_grants_installation_workspace_idx
  on public.workspace_node_permission_grants(installation_id, workspace_id);
create index workspace_node_permission_grants_granted_by_idx
  on public.workspace_node_permission_grants(granted_by);
create index workspace_node_permission_grants_revoked_by_idx
  on public.workspace_node_permission_grants(revoked_by) where revoked_by is not null;

-- Make the privileged-only platform audit access explicit for RLS tooling.
create policy node_platform_audit_events_service_role_all
  on public.node_platform_audit_events for all to service_role
  using (true) with check (true);
