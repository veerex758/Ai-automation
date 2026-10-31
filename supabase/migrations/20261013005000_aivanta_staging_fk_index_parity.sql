-- Track staging indexes already present in the remote baseline for foreign-key and
-- workspace membership lookups. These are additive and safe to replay.
create index if not exists workflow_schedules_created_by_idx
  on public.workflow_schedules (created_by);

create index if not exists workflow_schedules_workspace_id_idx
  on public.workflow_schedules (workspace_id);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id, workspace_id);
