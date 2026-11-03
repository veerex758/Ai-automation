-- Atomic platform-only publisher verification and package approval.
-- The API performs a fail-closed user allowlist check; only the server service role
-- can call this function. State transition and audit event commit together.

create or replace function public.review_node_registry_resource(
  p_action text,
  p_resource_id uuid,
  p_actor_user_id uuid,
  p_evidence_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_publisher public.node_publishers%rowtype;
  v_version public.node_package_versions%rowtype;
  v_package public.node_packages%rowtype;
  v_missing text[] := '{}'::text[];
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_actor_user_id is null or not exists (
    select 1 from auth.users where id = p_actor_user_id
  ) then
    raise exception 'Valid platform reviewer identity required' using errcode = '22023';
  end if;

  if p_action = 'verify_publisher' then
    if p_evidence_reference is null
      or length(trim(p_evidence_reference)) < 12
      or length(trim(p_evidence_reference)) > 2048
      or trim(p_evidence_reference) !~* '^https://' then
      raise exception 'Secure publisher evidence reference required' using errcode = '22023';
    end if;

    select * into v_publisher
    from public.node_publishers
    where id = p_resource_id
    for update;
    if not found then
      raise exception 'Publisher not found' using errcode = 'P0002';
    end if;
    if v_publisher.verification_status <> 'pending' then
      raise exception 'Publisher is not pending verification' using errcode = '22023';
    end if;

    update public.node_publishers
    set verification_status = 'verified',
        verified_at = v_now,
        verified_by = p_actor_user_id,
        updated_at = v_now
    where id = p_resource_id;

    insert into public.node_platform_audit_events (
      actor_user_id, event_type, resource_type, resource_id, metadata
    ) values (
      p_actor_user_id, 'node.publisher_verified', 'node_publisher', p_resource_id::text,
      jsonb_build_object(
        'publisher_slug', v_publisher.slug,
        'evidence_reference', trim(p_evidence_reference),
        'verification_method', 'manual_platform_review'
      )
    );

    return jsonb_build_object('id', p_resource_id, 'status', 'verified');
  elsif p_action = 'approve_version' then
    select * into v_version
    from public.node_package_versions
    where id = p_resource_id
    for update;
    if not found then
      raise exception 'Package version not found' using errcode = 'P0002';
    end if;
    if v_version.review_status <> 'pending_review' then
      raise exception 'Package version is not pending review' using errcode = '22023';
    end if;

    select * into v_package
    from public.node_packages
    where id = v_version.package_id;
    if not found or v_package.status <> 'active' then
      raise exception 'Package is not active' using errcode = '22023';
    end if;

    select * into v_publisher
    from public.node_publishers
    where id = v_package.publisher_id;
    if not found or v_publisher.verification_status <> 'verified' then
      v_missing := array_append(v_missing, 'verified_publisher');
    end if;
    if not v_version.publisher_provenance_verified then
      v_missing := array_append(v_missing, 'publisher_provenance');
    end if;
    if v_version.dependency_scan_status <> 'passed' then
      v_missing := array_append(v_missing, 'dependency_scan');
    end if;
    if v_version.malware_scan_status <> 'passed' then
      v_missing := array_append(v_missing, 'malware_scan');
    end if;
    if v_version.permissions_reviewed_at is null then
      v_missing := array_append(v_missing, 'permission_review');
    end if;

    if cardinality(v_missing) > 0 then
      raise exception 'Package approval gates are incomplete: %', array_to_string(v_missing, ', ')
        using errcode = '22023';
    end if;

    update public.node_package_versions
    set review_status = 'approved',
        approved_at = v_now,
        approved_by = p_actor_user_id
    where id = p_resource_id;

    insert into public.node_platform_audit_events (
      actor_user_id, event_type, resource_type, resource_id, metadata
    ) values (
      p_actor_user_id, 'node.version_approved', 'node_package_version', p_resource_id::text,
      jsonb_build_object(
        'package_name', v_package.package_name,
        'package_version', v_version.version,
        'artifact_integrity', v_version.artifact_integrity,
        'approval_method', 'manual_platform_review'
      )
    );

    return jsonb_build_object('id', p_resource_id, 'status', 'approved');
  else
    raise exception 'Unsupported platform review action' using errcode = '22023';
  end if;
end;
$function$;

revoke all on function public.review_node_registry_resource(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.review_node_registry_resource(text, uuid, uuid, text) to service_role;
