-- Community packages are metadata-installed but cannot execute until the isolated worker is available.
alter table public.workspace_node_installations
  alter column status set default 'disabled';
alter table public.workspace_node_installations
  alter column disabled_at set default now();

drop policy workspace_node_installations_admin_insert
  on public.workspace_node_installations;
create policy workspace_node_installations_admin_insert
  on public.workspace_node_installations for insert to authenticated
  with check (
    private.is_workspace_admin(workspace_id)
    and installed_by = (select auth.uid())
    and status = 'disabled'
    and disabled_at is not null
    and uninstalled_at is null
    and exists (
      select 1
      from public.node_package_versions v
      join public.node_packages p on p.id = v.package_id
      join public.node_publishers pub on pub.id = p.publisher_id
      where v.id = package_version_id
        and v.review_status = 'approved'
        and p.status = 'active'
        and pub.verification_status = 'verified'
    )
  );

drop policy workspace_node_installations_admin_update
  on public.workspace_node_installations;
create policy workspace_node_installations_admin_update
  on public.workspace_node_installations for update to authenticated
  using (
    private.is_workspace_admin(workspace_id)
    and status <> 'uninstalled'
  )
  with check (
    private.is_workspace_admin(workspace_id)
    and (
      (status = 'disabled' and disabled_at is not null and uninstalled_at is null)
      or (status = 'uninstalled' and uninstalled_at is not null)
    )
  );

drop policy workspace_node_permission_grants_admin_insert
  on public.workspace_node_permission_grants;
create policy workspace_node_permission_grants_admin_insert
  on public.workspace_node_permission_grants for insert to authenticated
  with check (
    private.is_workspace_admin(workspace_id)
    and granted_by = (select auth.uid())
    and exists (
      select 1
      from public.workspace_node_installations i
      join public.node_package_versions v on v.id = i.package_version_id
      where i.id = installation_id
        and i.workspace_id = workspace_node_permission_grants.workspace_id
        and i.status in ('active','disabled')
        and (v.manifest -> 'permissions') ? permission
    )
  );

comment on column public.workspace_node_installations.status is
  'Community package installations remain disabled until an isolated execution worker is deployed and explicitly enables them.';
