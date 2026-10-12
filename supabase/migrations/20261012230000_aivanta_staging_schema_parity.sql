-- Reconcile the isolated staging schema with the repository's canonical Supabase migrations.
-- Idempotent additive reconciliation; no production references and no live execution enabled.

alter table public.workflow_versions
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists workflow_versions_created_by_idx on public.workflow_versions(created_by);
create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists workflow_runs_created_by_idx on public.workflow_runs(created_by);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.workspaces'::regclass and conname = 'workspaces_name_length_check') then
    alter table public.workspaces add constraint workspaces_name_length_check check (char_length(trim(name)) between 1 and 120) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.workflows'::regclass and conname = 'workflows_name_length_check') then
    alter table public.workflows add constraint workflows_name_length_check check (char_length(trim(name)) between 1 and 80) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.workflows'::regclass and conname = 'workflows_definition_object_check') then
    alter table public.workflows add constraint workflows_definition_object_check check (jsonb_typeof(definition) = 'object') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.workflow_versions'::regclass and conname = 'workflow_versions_definition_object_check') then
    alter table public.workflow_versions add constraint workflow_versions_definition_object_check check (jsonb_typeof(definition) = 'object') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.audit_events'::regclass and conname = 'audit_events_metadata_object_check') then
    alter table public.audit_events add constraint audit_events_metadata_object_check check (jsonb_typeof(metadata) = 'object') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.workflow_runs'::regclass and conname = 'workflow_runs_completion_order') then
    alter table public.workflow_runs add constraint workflow_runs_completion_order check (completed_at >= started_at) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.workflow_run_steps'::regclass and conname = 'workflow_run_steps_completion_order') then
    alter table public.workflow_run_steps add constraint workflow_run_steps_completion_order check (completed_at >= started_at) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.workflow_run_steps'::regclass and conname = 'workflow_run_steps_unique_id') then
    alter table public.workflow_run_steps add constraint workflow_run_steps_unique_id unique (run_id, step_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.workflow_schedules'::regclass and conname = 'workflow_schedules_lease_pair_check') then
    alter table public.workflow_schedules add constraint workflow_schedules_lease_pair_check check ((lease_token is null) = (lease_until is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.workflow_schedules'::regclass and conname = 'workflow_schedules_workspace_workflow_unique') then
    alter table public.workflow_schedules add constraint workflow_schedules_workspace_workflow_unique unique (workflow_id, workspace_id);
  end if;
end $$;

alter table public.workspaces validate constraint workspaces_name_length_check;
alter table public.workflows validate constraint workflows_name_length_check;
alter table public.workflows validate constraint workflows_definition_object_check;
alter table public.workflow_versions validate constraint workflow_versions_definition_object_check;
alter table public.audit_events validate constraint audit_events_metadata_object_check;
alter table public.workflow_runs validate constraint workflow_runs_completion_order;
alter table public.workflow_run_steps validate constraint workflow_run_steps_completion_order;
alter table public.workflow_schedules validate constraint workflow_schedules_lease_pair_check;
