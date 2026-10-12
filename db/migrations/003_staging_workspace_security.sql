-- Aivanta staging rebuild: workspace ownership, workflow persistence, run history, and tenant isolation.
-- Apply only to the isolated staging project. Live execution remains disabled in application configuration.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id, workspace_id);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name varchar(80) not null,
  description varchar(500) not null default '',
  definition jsonb not null default '{}'::jsonb,
  status varchar(16) not null default 'draft' check (status in ('draft','active','paused','archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workflows_workspace_updated_idx on public.workflows(workspace_id, updated_at desc);
create index if not exists workflows_created_by_idx on public.workflows(created_by);

create table if not exists public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  version integer not null check (version > 0),
  definition jsonb not null,
  created_at timestamptz not null default now(),
  unique (workflow_id, version)
);
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type varchar(100) not null,
  resource_type varchar(80) not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_workspace_created_idx on public.audit_events(workspace_id, created_at desc);
create index if not exists audit_events_actor_user_id_idx on public.audit_events(actor_user_id);

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  workflow_version integer not null check (workflow_version > 0),
  mode text not null default 'dry_run' check (mode = 'dry_run'),
  status text not null check (status in ('in_progress','succeeded','failed')),
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  constraint workflow_runs_completion_order check (completed_at is null or completed_at >= started_at)
);
create index if not exists workflow_runs_workspace_created_idx on public.workflow_runs(workspace_id, created_at desc);
create index if not exists workflow_runs_workflow_created_idx on public.workflow_runs(workflow_id, created_at desc);
create index if not exists workflow_runs_created_by_idx on public.workflow_runs(created_by);

create table if not exists public.workflow_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  step_id text not null check (length(step_id) between 1 and 64),
  position integer not null check (position > 0),
  step_type text not null check (step_type in ('trigger','action','condition')),
  title varchar(80) not null,
  status text not null check (status in ('simulated','skipped','failed')),
  result jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  constraint workflow_run_steps_unique_id unique (run_id, step_id),
  constraint workflow_run_steps_completion_order check (completed_at >= started_at)
);
create index if not exists workflow_run_steps_run_position_idx on public.workflow_run_steps(run_id, position);
create index if not exists workflow_run_steps_workspace_idx on public.workflow_run_steps(workspace_id, run_id);

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = (select auth.uid())
  );
$$;
create or replace function private.is_workspace_admin(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid()) and wm.role in ('owner','admin')
  );
$$;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.audit_events enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_run_steps enable row level security;

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member on public.workspaces for select to authenticated
using (private.is_workspace_member(id) or owner_id = (select auth.uid()));
drop policy if exists workspaces_insert_owner on public.workspaces;
create policy workspaces_insert_owner on public.workspaces for insert to authenticated
with check (owner_id = (select auth.uid()));
drop policy if exists workspaces_update_admin on public.workspaces;
create policy workspaces_update_admin on public.workspaces for update to authenticated
using (private.is_workspace_admin(id)) with check (private.is_workspace_admin(id));

drop policy if exists workspace_members_select_self_or_admin on public.workspace_members;
create policy workspace_members_select_self_or_admin on public.workspace_members for select to authenticated
using (user_id = (select auth.uid()) or private.is_workspace_admin(workspace_id));
drop policy if exists workspace_members_insert_admin_or_owner_setup on public.workspace_members;
create policy workspace_members_insert_admin_or_owner_setup on public.workspace_members for insert to authenticated
with check (
  private.is_workspace_admin(workspace_id)
  or (user_id = (select auth.uid()) and role = 'owner'
      and exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())))
);
drop policy if exists workspace_members_update_admin on public.workspace_members;
create policy workspace_members_update_admin on public.workspace_members for update to authenticated
using (private.is_workspace_admin(workspace_id)) with check (private.is_workspace_admin(workspace_id));
drop policy if exists workspace_members_delete_admin on public.workspace_members;
create policy workspace_members_delete_admin on public.workspace_members for delete to authenticated
using (private.is_workspace_admin(workspace_id) and user_id <> (select auth.uid()));

drop policy if exists workflows_select_member on public.workflows;
create policy workflows_select_member on public.workflows for select to authenticated
using (private.is_workspace_member(workspace_id));
drop policy if exists workflows_insert_member on public.workflows;
create policy workflows_insert_member on public.workflows for insert to authenticated
with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
drop policy if exists workflows_update_member on public.workflows;
create policy workflows_update_member on public.workflows for update to authenticated
using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
drop policy if exists workflows_delete_admin on public.workflows;
create policy workflows_delete_admin on public.workflows for delete to authenticated
using (private.is_workspace_admin(workspace_id));

drop policy if exists workflow_versions_select_member on public.workflow_versions;
create policy workflow_versions_select_member on public.workflow_versions for select to authenticated
using (exists (select 1 from public.workflows w where w.id = workflow_id and private.is_workspace_member(w.workspace_id)));
drop policy if exists workflow_versions_insert_member on public.workflow_versions;
create policy workflow_versions_insert_member on public.workflow_versions for insert to authenticated
with check (exists (select 1 from public.workflows w where w.id = workflow_id and private.is_workspace_member(w.workspace_id)));

drop policy if exists audit_events_select_member on public.audit_events;
create policy audit_events_select_member on public.audit_events for select to authenticated
using (private.is_workspace_member(workspace_id));
drop policy if exists audit_events_insert_member on public.audit_events;
create policy audit_events_insert_member on public.audit_events for insert to authenticated
with check (private.is_workspace_member(workspace_id) and (actor_user_id is null or actor_user_id = (select auth.uid())));

drop policy if exists workflow_runs_select_member on public.workflow_runs;
create policy workflow_runs_select_member on public.workflow_runs for select to authenticated
using (private.is_workspace_member(workspace_id));
drop policy if exists workflow_runs_insert_dry_run on public.workflow_runs;
create policy workflow_runs_insert_dry_run on public.workflow_runs for insert to authenticated
with check (
  private.is_workspace_member(workspace_id) and created_by = (select auth.uid()) and mode = 'dry_run'
  and exists (select 1 from public.workflows w where w.id = workflow_id and w.workspace_id = workflow_runs.workspace_id)
);
drop policy if exists workflow_runs_update_member on public.workflow_runs;
create policy workflow_runs_update_member on public.workflow_runs for update to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id) and mode = 'dry_run');

drop policy if exists workflow_run_steps_select_member on public.workflow_run_steps;
create policy workflow_run_steps_select_member on public.workflow_run_steps for select to authenticated
using (private.is_workspace_member(workspace_id));
drop policy if exists workflow_run_steps_insert_member on public.workflow_run_steps;
create policy workflow_run_steps_insert_member on public.workflow_run_steps for insert to authenticated
with check (
  private.is_workspace_member(workspace_id)
  and exists (select 1 from public.workflow_runs r where r.id = run_id and r.workspace_id = workflow_run_steps.workspace_id)
);

grant select, insert, update on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.workflows to authenticated;
grant select, insert on public.workflow_versions to authenticated;
grant select, insert on public.audit_events to authenticated;
grant select, insert, update on public.workflow_runs to authenticated;
grant select, insert on public.workflow_run_steps to authenticated;
revoke all on public.workspaces, public.workspace_members, public.workflows, public.workflow_versions,
  public.audit_events, public.workflow_runs, public.workflow_run_steps from anon;

create index if not exists workspaces_owner_id_idx on public.workspaces(owner_id);
