-- Transactional, authenticated workspace lifecycle operations.
-- These are SECURITY INVOKER functions: RLS and caller privileges remain in force.

create or replace function public.create_workspace_node_installation(
  p_workspace_id uuid,
  p_package_version_id uuid,
  p_permissions text[] default '{}'::text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_package_name text;
  v_package_version text;
  v_artifact_integrity text;
  v_manifest jsonb;
  v_installation_id uuid;
  v_permission text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_workspace_admin(p_workspace_id) then
    raise exception 'Workspace administrator access required' using errcode = '42501';
  end if;
  p_permissions := coalesce(p_permissions, '{}'::text[]);
  if cardinality(p_permissions) > 7
    or cardinality(p_permissions) <> (
      select count(distinct permission_value)
      from unnest(p_permissions) as requested(permission_value)
    ) then
    raise exception 'Invalid or duplicate permission list' using errcode = '22023';
  end if;

  select p.package_name, v.version, v.artifact_integrity, v.manifest
    into v_package_name, v_package_version, v_artifact_integrity, v_manifest
  from public.node_package_versions v
  join public.node_packages p on p.id = v.package_id
  join public.node_publishers pub on pub.id = p.publisher_id
  where v.id = p_package_version_id
    and v.review_status = 'approved'
    and p.status = 'active'
    and pub.verification_status = 'verified';

  if not found then
    raise exception 'Approved node package version not found' using errcode = 'P0002';
  end if;

  foreach v_permission in array p_permissions loop
    if not exists (
      select 1 from jsonb_array_elements_text(v_manifest -> 'permissions') declared(value)
      where declared.value = v_permission
    ) then
      raise exception 'Requested permission is not declared by the package' using errcode = '22023';
    end if;
  end loop;

  insert into public.workspace_node_installations (
    workspace_id, package_version_id, status, installed_by, disabled_at
  ) values (
    p_workspace_id, p_package_version_id, 'disabled', v_actor, now()
  ) returning id into v_installation_id;

  foreach v_permission in array p_permissions loop
    insert into public.workspace_node_permission_grants (
      installation_id, workspace_id, permission, status, granted_by
    ) values (
      v_installation_id, p_workspace_id, v_permission, 'active', v_actor
    );

    insert into public.audit_events (
      workspace_id, actor_user_id, event_type, resource_type, resource_id, metadata
    ) values (
      p_workspace_id, v_actor, 'node.permission_granted',
      'workspace_node_installation', v_installation_id::text,
      jsonb_build_object(
        'package_name', v_package_name,
        'package_version', v_package_version,
        'installation_id', v_installation_id::text,
        'permission', v_permission
      )
    );
  end loop;

  insert into public.audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id, metadata
  ) values (
    p_workspace_id, v_actor, 'node.installation_created',
    'workspace_node_installation', v_installation_id::text,
    jsonb_build_object(
      'package_name', v_package_name,
      'package_version', v_package_version,
      'installation_id', v_installation_id::text,
      'artifact_integrity', v_artifact_integrity,
      'reason_code', 'worker_not_available'
    )
  );

  return v_installation_id;
end;
$function$;

create or replace function public.set_workspace_node_permission(
  p_installation_id uuid,
  p_permission text,
  p_action text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_workspace_id uuid;
  v_installation_status text;
  v_manifest jsonb;
  v_grant_id uuid;
  v_event_type text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_action is null or p_action not in ('grant','revoke') then
    raise exception 'Invalid permission action' using errcode = '22023';
  end if;
  if p_permission is null then
    raise exception 'Permission is required' using errcode = '22023';
  end if;

  select i.workspace_id, i.status
    into v_workspace_id, v_installation_status
  from public.workspace_node_installations i
  where i.id = p_installation_id;

  if not found then
    raise exception 'Installation not found' using errcode = 'P0002';
  end if;
  if not private.is_workspace_admin(v_workspace_id) then
    raise exception 'Workspace administrator access required' using errcode = '42501';
  end if;
  if v_installation_status = 'uninstalled' then
    raise exception 'Uninstalled node packages cannot change permissions' using errcode = '22023';
  end if;

  if p_action = 'grant' then
    select v.manifest into v_manifest
    from public.workspace_node_installations i
    join public.node_package_versions v on v.id = i.package_version_id
    join public.node_packages p on p.id = v.package_id
    join public.node_publishers pub on pub.id = p.publisher_id
    where i.id = p_installation_id
      and v.review_status = 'approved'
      and p.status = 'active'
      and pub.verification_status = 'verified';

    if not found then
      raise exception 'Package is not currently approved for installation' using errcode = '22023';
    end if;
    if not ((v_manifest -> 'permissions') ? p_permission) then
      raise exception 'Permission is not declared by the package' using errcode = '22023';
    end if;

    insert into public.workspace_node_permission_grants (
      installation_id, workspace_id, permission, status, granted_by
    ) values (
      p_installation_id, v_workspace_id, p_permission, 'active', v_actor
    )
    on conflict (installation_id, permission) where status = 'active'
    do nothing
    returning id into v_grant_id;

    if v_grant_id is null then
      return false;
    end if;
    v_event_type := 'node.permission_granted';
  else
    update public.workspace_node_permission_grants
    set status = 'revoked', revoked_by = v_actor, revoked_at = now()
    where installation_id = p_installation_id
      and workspace_id = v_workspace_id
      and permission = p_permission
      and status = 'active'
    returning id into v_grant_id;

    if v_grant_id is null then
      return false;
    end if;
    v_event_type := 'node.permission_revoked';
  end if;

  insert into public.audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id, metadata
  ) values (
    v_workspace_id, v_actor, v_event_type,
    'workspace_node_installation', p_installation_id::text,
    jsonb_build_object(
      'installation_id', p_installation_id::text,
      'permission', p_permission
    )
  );

  return true;
end;
$function$;

create or replace function public.set_workspace_node_installation_state(
  p_installation_id uuid,
  p_status text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_workspace_id uuid;
  v_current_status text;
  v_grant record;
  v_event_type text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_status is null or p_status not in ('disabled','uninstalled') then
    raise exception 'Installations cannot be activated until the isolated worker is available' using errcode = '22023';
  end if;

  select i.workspace_id, i.status
    into v_workspace_id, v_current_status
  from public.workspace_node_installations i
  where i.id = p_installation_id;

  if not found then
    raise exception 'Installation not found' using errcode = 'P0002';
  end if;
  if not private.is_workspace_admin(v_workspace_id) then
    raise exception 'Workspace administrator access required' using errcode = '42501';
  end if;
  if v_current_status = 'uninstalled' or v_current_status = p_status then
    return false;
  end if;

  if p_status = 'uninstalled' then
    for v_grant in
      update public.workspace_node_permission_grants
      set status = 'revoked', revoked_by = v_actor, revoked_at = now()
      where installation_id = p_installation_id
        and workspace_id = v_workspace_id
        and status = 'active'
      returning permission
    loop
      insert into public.audit_events (
        workspace_id, actor_user_id, event_type, resource_type, resource_id, metadata
      ) values (
        v_workspace_id, v_actor, 'node.permission_revoked',
        'workspace_node_installation', p_installation_id::text,
        jsonb_build_object(
          'installation_id', p_installation_id::text,
          'permission', v_grant.permission
        )
      );
    end loop;
    v_event_type := 'node.installation_uninstalled';
  else
    v_event_type := 'node.installation_disabled';
  end if;

  update public.workspace_node_installations
  set status = p_status,
      disabled_at = coalesce(disabled_at, now()),
      uninstalled_at = case when p_status = 'uninstalled' then now() else null end
  where id = p_installation_id
    and workspace_id = v_workspace_id;

  insert into public.audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id, metadata
  ) values (
    v_workspace_id, v_actor, v_event_type,
    'workspace_node_installation', p_installation_id::text,
    jsonb_build_object(
      'installation_id', p_installation_id::text,
      'reason_code', case when p_status = 'uninstalled' then 'workspace_uninstall' else 'workspace_disabled' end
    )
  );

  return true;
end;
$function$;

revoke all on function public.create_workspace_node_installation(uuid, uuid, text[]) from public, anon;
revoke all on function public.set_workspace_node_permission(uuid, text, text) from public, anon;
revoke all on function public.set_workspace_node_installation_state(uuid, text) from public, anon;
grant execute on function public.create_workspace_node_installation(uuid, uuid, text[]) to authenticated;
grant execute on function public.set_workspace_node_permission(uuid, text, text) to authenticated;
grant execute on function public.set_workspace_node_installation_state(uuid, text) to authenticated;
