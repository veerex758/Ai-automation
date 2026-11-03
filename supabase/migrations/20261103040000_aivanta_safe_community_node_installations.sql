-- Safe, workspace-scoped community-node installation metadata and append-only audit history.
-- This migration does not install or execute npm packages.
--
-- Rollback (only if this feature has not accumulated data that must be retained):
--   drop table if exists public.workspace_node_installation_audit;
--   drop table if exists public.workspace_node_installations;

create table if not exists public.workspace_node_installations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  package_name text not null check (package_name ~ '^(@[a-z0-9._-]+/)?[a-z0-9._-]+$'),
  package_version text not null check (length(package_version) between 1 and 64),
  package_integrity text check (package_integrity is null or package_integrity ~ '^sha512-[A-Za-z0-9+/=]+$'),
  registry text not null default 'https://registry.npmjs.org' check (registry = 'https://registry.npmjs.org'),
  adapter_id text check (adapter_id is null or adapter_id ~ '^[a-z][a-z0-9._-]{1,79}$'),
  status text not null default 'pending_review'
    check (status in ('pending_review','approved','installed','disabled','blocked','uninstalled')),
  manifest_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest_snapshot) = 'object'),
  requested_permissions jsonb not null default '[]'::jsonb check (jsonb_typeof(requested_permissions) = 'array'),
  risk_assessment jsonb not null default '{}'::jsonb check (jsonb_typeof(risk_assessment) = 'object'),
  review_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  installed_by uuid references auth.users(id) on delete set null,
  installed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, package_name),
  check (status <> 'installed' or (package_integrity is not null and adapter_id is not null and installed_at is not null)),
  check (status not in ('approved','installed','disabled') or (reviewed_by is not null and reviewed_at is not null))
);

create index if not exists workspace_node_installations_workspace_status_idx
  on public.workspace_node_installations(workspace_id, status, package_name);

create table if not exists public.workspace_node_installation_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  installation_id uuid references public.workspace_node_installations(id) on delete set null,
  package_name text not null check (package_name ~ '^(@[a-z0-9._-]+/)?[a-z0-9._-]+$'),
  package_version text,
  event_type text not null check (event_type in (
    'discovered','review_requested','approved','rejected','installed',
    'disabled','enabled','updated','uninstalled','blocked'
  )),
  actor_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists workspace_node_installation_audit_workspace_created_idx
  on public.workspace_node_installation_audit(workspace_id, created_at desc);
create index if not exists workspace_node_installation_audit_installation_created_idx
  on public.workspace_node_installation_audit(installation_id, created_at desc);

alter table public.workspace_node_installations enable row level security;
alter table public.workspace_node_installation_audit enable row level security;

create policy "workspace members can read node installations"
  on public.workspace_node_installations for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- No authenticated policies are created for writes or audit access.
-- Server-side handlers must verify owner/admin role before service-role mutations.
revoke all on public.workspace_node_installations from anon;
revoke insert, update, delete on public.workspace_node_installations from authenticated;
grant select on public.workspace_node_installations to authenticated;
grant all on public.workspace_node_installations to service_role;

revoke all on public.workspace_node_installation_audit from public, anon, authenticated;
grant all on public.workspace_node_installation_audit to service_role;

comment on table public.workspace_node_installations is
  'Workspace-scoped, reviewed community-node installation metadata. Does not authorize arbitrary package execution.';
comment on table public.workspace_node_installation_audit is
  'Server-written audit trail for community-node discovery, review, install, update, disable, and removal.';
