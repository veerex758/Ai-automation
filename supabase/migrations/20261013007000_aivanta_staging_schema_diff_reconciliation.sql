-- Reconcile the clean migration replay with the verified Aivanta staging catalog.
-- This removes legacy permissive policies and redundant constraint names left by
-- the original foundation migration, while retaining the canonical guarded paths.
-- Reviewed against the staging schema-diff artifact; no production changes are made.

-- Remove the legacy policies replaced by the current least-privilege policy set.
drop policy if exists "members can create audit events" on public.audit_events;
drop policy if exists "members can read audit events" on public.audit_events;
drop policy if exists "members can create workflow versions" on public.workflow_versions;
drop policy if exists "members can read workflow versions" on public.workflow_versions;
drop policy if exists "members can create workflows" on public.workflows;
drop policy if exists "members can delete workflows" on public.workflows;
drop policy if exists "members can read workflows" on public.workflows;
drop policy if exists "members can update workflows" on public.workflows;
drop policy if exists "members can read workspace membership" on public.workspace_members;
drop policy if exists "workspace owners can add members" on public.workspace_members;
drop policy if exists "workspace owners can remove members" on public.workspace_members;
drop policy if exists "workspace owners can update members" on public.workspace_members;
drop policy if exists "users can create owned workspaces" on public.workspaces;
drop policy if exists "workspace members can read workspaces" on public.workspaces;
drop policy if exists "workspace owners can delete workspaces" on public.workspaces;
drop policy if exists "workspace owners can update workspaces" on public.workspaces;

-- Keep the canonical named checks; the older checks enforce the same invariants.
alter table public.audit_events
  drop constraint if exists audit_events_metadata_check;
alter table public.workflow_versions
  drop constraint if exists workflow_versions_definition_check;
alter table public.workflows
  drop constraint if exists workflows_definition_check;
alter table public.workflows
  drop constraint if exists workflows_name_check;
alter table public.workspaces
  drop constraint if exists workspaces_name_check;

-- Match staging's explicit attribution and status-column contract.
alter table public.audit_events alter column actor_user_id drop default;
alter table public.workflow_versions alter column created_by drop default;
alter table public.workflows alter column created_by drop default;
alter table public.workflows alter column status set default 'draft';
alter table public.workflows alter column status drop constraint if exists workflows_status_check;
alter table public.workflows alter column status type varchar(16) using status::varchar(16);
alter table public.workflows
  add constraint workflows_status_check
  check (status in ('draft', 'active', 'paused', 'archived')) not valid;
alter table public.workflows validate constraint workflows_status_check;

-- Staging uses a full creator lookup index rather than the legacy partial index.
drop index if exists public.workflow_runs_created_by_idx;
create index workflow_runs_created_by_idx
  on public.workflow_runs using btree (created_by);
