-- Aivanta node installation registry and workspace consent model.
-- Platform trust is separate from workspace installation/permission consent.

create table public.node_publishers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  website_url text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected','suspended')),
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (verification_status = 'verified' and verified_at is not null and verified_by is not null)
    or verification_status <> 'verified'
  )
);

create table public.node_packages (
  id uuid primary key default gen_random_uuid(),
  publisher_id uuid not null references public.node_publishers(id) on delete restrict,
  package_name text not null unique
    check (package_name ~ '^@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$'),
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  description text not null default '',
  status text not null default 'active' check (status in ('active','quarantined','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.node_package_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.node_packages(id) on delete restrict,
  version text not null check (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  runtime_api_version text not null,
  entrypoint text not null
    check (entrypoint <> '' and left(entrypoint, 1) <> '/' and entrypoint !~ '(^|/)\.\.(/|$)'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object' and jsonb_typeof(manifest -> 'permissions') = 'array'),
  artifact_integrity text not null
    check (artifact_integrity ~ '^sha512-[A-Za-z0-9+/]{86}==$'),
  publisher_provenance_verified boolean not null default false,
  dependency_scan_status text not null default 'pending'
    check (dependency_scan_status in ('pending','passed','failed')),
  malware_scan_status text not null default 'pending'
    check (malware_scan_status in ('pending','passed','failed')),
  permissions_reviewed_at timestamptz,
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review','approved','rejected','quarantined')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (package_id, version),
  check (
    review_status <> 'approved'
    or (
      publisher_provenance_verified
      and dependency_scan_status = 'passed'
      and malware_scan_status = 'passed'
      and permissions_reviewed_at is not null
      and approved_at is not null
      and approved_by is not null
    )
  )
);

create index node_package_versions_package_idx
  on public.node_package_versions(package_id, created_at desc);

create table public.workspace_node_installations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  package_version_id uuid not null references public.node_package_versions(id) on delete restrict,
  status text not null default 'active' check (status in ('active','disabled','uninstalled')),
  installed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  uninstalled_at timestamptz,
  unique (id, workspace_id),
  check (
    (status = 'active' and disabled_at is null and uninstalled_at is null)
    or (status = 'disabled' and disabled_at is not null and uninstalled_at is null)
    or (status = 'uninstalled' and uninstalled_at is not null)
  )
);

create unique index workspace_node_installations_live_unique
  on public.workspace_node_installations(workspace_id, package_version_id)
  where status in ('active','disabled');
create index workspace_node_installations_workspace_idx
  on public.workspace_node_installations(workspace_id, created_at desc);

create table public.workspace_node_permission_grants (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  workspace_id uuid not null,
  permission text not null check (permission ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
  status text not null default 'active' check (status in ('active','revoked')),
  granted_by uuid not null references auth.users(id) on delete restrict,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (installation_id, permission),
  foreign key (installation_id, workspace_id)
    references public.workspace_node_installations(id, workspace_id) on delete cascade,
  check (
    (status = 'active' and revoked_at is null and revoked_by is null)
    or (status = 'revoked' and revoked_at is not null and revoked_by is not null)
  )
);

create index workspace_node_permission_grants_workspace_idx
  on public.workspace_node_permission_grants(workspace_id, installation_id);

create table public.node_platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'node.publisher_verified',
    'node.version_submitted',
    'node.version_approved',
    'node.version_rejected',
    'node.package_quarantined'
  )),
  resource_type text not null check (resource_type in ('node_publisher','node_package','node_package_version')),
  resource_id text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index node_platform_audit_events_created_idx
  on public.node_platform_audit_events(created_at desc);

-- All exposed tables are RLS protected. Platform registry writes are server-only.
alter table public.node_publishers enable row level security;
alter table public.node_packages enable row level security;
alter table public.node_package_versions enable row level security;
alter table public.workspace_node_installations enable row level security;
alter table public.workspace_node_permission_grants enable row level security;
alter table public.node_platform_audit_events enable row level security;

create policy node_publishers_verified_select
  on public.node_publishers for select to authenticated
  using (verification_status = 'verified');

create policy node_packages_approved_select
  on public.node_packages for select to authenticated
  using (
    status = 'active'
    and exists (
      select 1 from public.node_publishers p
      where p.id = publisher_id and p.verification_status = 'verified'
    )
  );

create policy node_package_versions_approved_select
  on public.node_package_versions for select to authenticated
  using (
    review_status = 'approved'
    and exists (
      select 1
      from public.node_packages p
      join public.node_publishers pub on pub.id = p.publisher_id
      where p.id = package_id
        and p.status = 'active'
        and pub.verification_status = 'verified'
    )
  );

create policy workspace_node_installations_member_select
  on public.workspace_node_installations for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy workspace_node_installations_admin_insert
  on public.workspace_node_installations for insert to authenticated
  with check (
    private.is_workspace_admin(workspace_id)
    and installed_by = (select auth.uid())
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

create policy workspace_node_installations_admin_update
  on public.workspace_node_installations for update to authenticated
  using (private.is_workspace_admin(workspace_id))
  with check (private.is_workspace_admin(workspace_id));

create policy workspace_node_permission_grants_member_select
  on public.workspace_node_permission_grants for select to authenticated
  using (private.is_workspace_member(workspace_id));

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
        and i.status = 'active'
        and (v.manifest -> 'permissions') ? permission
    )
  );

create policy workspace_node_permission_grants_admin_update
  on public.workspace_node_permission_grants for update to authenticated
  using (private.is_workspace_admin(workspace_id))
  with check (
    private.is_workspace_admin(workspace_id)
    and (
      (status = 'active' and revoked_at is null and revoked_by is null)
      or (status = 'revoked' and revoked_at is not null and revoked_by = (select auth.uid()))
    )
    and exists (
      select 1
      from public.workspace_node_installations i
      join public.node_package_versions v on v.id = i.package_version_id
      where i.id = installation_id
        and i.workspace_id = workspace_id
        and (v.manifest -> 'permissions') ? permission
    )
  );

-- Keep workspace node audit events on a closed vocabulary and prevent secret-bearing
-- top-level metadata fields from entering the append-only audit stream.
alter table public.audit_events
  add constraint audit_events_node_event_shape_check
  check (
    event_type not like 'node.%'
    or (
      event_type in (
        'node.installation_created',
        'node.permission_granted',
        'node.permission_revoked',
        'node.installation_disabled',
        'node.installation_uninstalled'
      )
      and resource_type = 'workspace_node_installation'
      and resource_id is not null
      and not (metadata ?| array[
        'access_token','refresh_token','api_key','secret','password',
        'credentials','encrypted_credentials','authorization'
      ])
    )
  );

-- Existing member audit insert policy is retained; this restrictive policy
-- requires workspace admin authority for node lifecycle events specifically.
create policy audit_events_node_insert_admin
  on public.audit_events as restrictive for insert to authenticated
  with check (event_type not like 'node.%' or private.is_workspace_admin(workspace_id));

-- No authenticated mutation path for platform trust records or audit history.
revoke all on public.node_publishers, public.node_packages, public.node_package_versions,
  public.node_platform_audit_events from anon, authenticated;
grant select on public.node_publishers, public.node_packages, public.node_package_versions to authenticated;
grant select, insert, update on public.workspace_node_installations,
  public.workspace_node_permission_grants to authenticated;
revoke delete on public.workspace_node_installations, public.workspace_node_permission_grants from authenticated;
grant all on public.node_publishers, public.node_packages, public.node_package_versions,
  public.node_platform_audit_events to service_role;
grant select, insert on public.node_platform_audit_events to service_role;

-- Restrict workspace updates to lifecycle columns; immutable identifiers and
-- ownership fields cannot be reassigned by an authenticated client.
revoke update on public.workspace_node_installations from authenticated;
grant update (status, updated_at, disabled_at, uninstalled_at)
  on public.workspace_node_installations to authenticated;
revoke update on public.workspace_node_permission_grants from authenticated;
grant update (status, revoked_by, revoked_at, updated_at)
  on public.workspace_node_permission_grants to authenticated;

-- Keep modification timestamps server-generated for lifecycle rows.
create trigger workspace_node_installations_set_updated_at
  before update on public.workspace_node_installations
  for each row execute function public.set_updated_at();
create trigger workspace_node_permission_grants_set_updated_at
  before update on public.workspace_node_permission_grants
  for each row execute function public.set_updated_at();

-- Platform audit history is append-only even for the service role.
revoke update, delete, truncate on public.node_platform_audit_events from anon, authenticated, service_role;
