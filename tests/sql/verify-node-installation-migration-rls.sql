-- Apply this after the migration and fixture setup, using the disposable CI database.
insert into public.node_publishers (
  id, slug, display_name, verification_status, verified_at, verified_by
) values (
  '20000000-0000-4000-8000-000000000001',
  'aivanta',
  'Aivanta',
  'verified',
  now(),
  '00000000-0000-4000-8000-000000000001'
);
insert into public.node_packages (
  id, publisher_id, package_name, display_name
) values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '@aivanta/crm',
  'CRM Connector'
);
insert into public.node_package_versions (
  id, package_id, version, runtime_api_version, entrypoint, manifest,
  artifact_integrity, publisher_provenance_verified, dependency_scan_status,
  malware_scan_status, permissions_reviewed_at, review_status, approved_at, approved_by
) values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '1.2.3',
  '1',
  'dist/index.js',
  '{"permissions":["connector.invoke"]}'::jsonb,
  'sha512-' || repeat('A', 86) || '==',
  true,
  'passed',
  'passed',
  now(),
  'approved',
  now(),
  '00000000-0000-4000-8000-000000000001'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);

do $setup$
declare installation_id uuid;
begin
  installation_id := public.create_workspace_node_installation(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    array['connector.invoke']::text[]
  );
  perform set_config('test.installation_id', installation_id::text, false);
end;
$setup$;

do $$
begin
  begin
    insert into public.workspace_node_permission_grants (
      installation_id, workspace_id, permission, granted_by
    ) values (
      current_setting('test.installation_id')::uuid,
      '10000000-0000-4000-8000-000000000001',
      'http.outbound',
      '00000000-0000-4000-8000-000000000001'
    );
    raise exception 'Undeclared capability grant unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);

do $$
declare visible_count integer;
begin
  select count(*) into visible_count
  from public.workspace_node_installations
  where workspace_id = '10000000-0000-4000-8000-000000000002';
  if visible_count <> 0 then
    raise exception 'Cross-workspace installation rows were visible';
  end if;

  begin
    insert into public.workspace_node_installations (
      workspace_id, package_version_id, installed_by
    ) values (
      '10000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003'
    );
    raise exception 'Non-admin cross-workspace installation unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.audit_events (
      workspace_id, actor_user_id, event_type, resource_type, resource_id, metadata
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
      'node.permission_revoked',
      'workspace_node_installation',
      'install-test',
      '{}'::jsonb
    );
    raise exception 'Non-admin node audit event unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);

select public.set_workspace_node_permission(
  current_setting('test.installation_id')::uuid,
  'connector.invoke',
  'revoke'
);

-- A revoked grant cannot be silently reactivated; a new grant row preserves history.
do $$
declare affected integer;
begin
  update public.workspace_node_permission_grants
  set status = 'active', revoked_by = null, revoked_at = null
  where installation_id = current_setting('test.installation_id')::uuid
    and permission = 'connector.invoke'
    and status = 'revoked';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Revoked permission was unexpectedly reactivated';
  end if;
end;
$$;

select public.set_workspace_node_permission(
  current_setting('test.installation_id')::uuid,
  'connector.invoke',
  'grant'
);

do $verify$
begin
  if not exists (
    select 1 from public.workspace_node_permission_grants
    where installation_id = current_setting('test.installation_id')::uuid
      and permission = 'connector.invoke'
      and status = 'revoked'
  ) then
    raise exception 'Permission revocation did not persist';
  end if;
  if not exists (
    select 1 from public.workspace_node_installations
    where id = current_setting('test.installation_id')::uuid
      and status = 'disabled'
      and disabled_at is not null
      and uninstalled_at is null
  ) then
    raise exception 'New community installation must remain disabled until isolated worker activation';
  end if;

  update public.workspace_node_installations
  set status = 'active', disabled_at = null
  where id = current_setting('test.installation_id')::uuid;
  if found then
    raise exception 'Authenticated workspace admin unexpectedly activated an installation without worker approval';
  end if;


  if has_table_privilege('authenticated', 'public.node_platform_audit_events', 'SELECT') then
    raise exception 'Authenticated users must not read platform audit history';
  end if;

  if has_table_privilege('service_role', 'public.node_platform_audit_events', 'UPDATE') then
    raise exception 'Platform audit history must be append-only';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'node_publishers',
        'node_packages',
        'node_package_versions',
        'workspace_node_installations',
        'workspace_node_permission_grants',
        'node_platform_audit_events'
      )
      and not c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on every node installation table';
  end if;
  if (
    select count(*)
    from unnest(array[
      'node_publishers_verified_by_idx',
      'node_packages_publisher_id_idx',
      'node_package_versions_approved_by_idx',
      'node_platform_audit_events_actor_user_id_idx',
      'workspace_node_installations_package_version_id_idx',
      'workspace_node_installations_installed_by_idx',
      'workspace_node_permission_grants_installation_workspace_idx',
      'workspace_node_permission_grants_granted_by_idx',
      'workspace_node_permission_grants_revoked_by_idx'
    ]) expected(index_name)
    where not exists (
      select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = expected.index_name
    )
  ) <> 0 then
    raise exception 'One or more node installation foreign-key indexes are missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'node_platform_audit_events'
      and policyname = 'node_platform_audit_events_service_role_all'
      and roles = array['service_role']::name[]
  ) then
    raise exception 'Privileged platform audit policy is missing';
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_workspace_node_installation',
        'set_workspace_node_permission',
        'set_workspace_node_installation_state'
      )
      and p.prosecdef
  ) then
    raise exception 'Node lifecycle RPCs must remain SECURITY INVOKER';
  end if;

  if has_function_privilege('anon', 'public.create_workspace_node_installation(uuid,uuid,text[])', 'EXECUTE')
    or has_function_privilege('anon', 'public.set_workspace_node_permission(uuid,text,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.set_workspace_node_installation_state(uuid,text)', 'EXECUTE') then
    raise exception 'Anonymous users must not execute node lifecycle RPCs';
  end if;

  if not has_function_privilege('authenticated', 'public.create_workspace_node_installation(uuid,uuid,text[])', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.set_workspace_node_permission(uuid,text,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.set_workspace_node_installation_state(uuid,text)', 'EXECUTE') then
    raise exception 'Authenticated users must have the intended node lifecycle RPC grants';
  end if;
end;
$verify$;

-- Even if a package is later quarantined, workspace admins must still be able to revoke and uninstall.
reset role;
update public.node_packages
set status = 'quarantined'
where id = '30000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);

do $quarantine$
begin
  begin
    perform public.set_workspace_node_permission(
      current_setting('test.installation_id')::uuid,
      'connector.invoke',
      'grant'
    );
    raise exception 'Quarantined package unexpectedly accepted a new permission grant';
  exception when invalid_parameter_value then
    null;
  end;
end;
$quarantine$;

select public.set_workspace_node_permission(
  current_setting('test.installation_id')::uuid,
  'connector.invoke',
  'revoke'
);

select public.set_workspace_node_installation_state(
  current_setting('test.installation_id')::uuid,
  'uninstalled'
);

do $uninstall$
begin
  if not exists (
    select 1 from public.workspace_node_installations
    where id = current_setting('test.installation_id')::uuid
      and status = 'uninstalled'
      and uninstalled_at is not null
  ) then
    raise exception 'Uninstall state was not persisted';
  end if;
  if exists (
    select 1 from public.workspace_node_permission_grants
    where installation_id = current_setting('test.installation_id')::uuid
      and status = 'active'
  ) then
    raise exception 'Uninstall did not revoke every active permission grant';
  end if;
end;
$uninstall$;

reset role;
