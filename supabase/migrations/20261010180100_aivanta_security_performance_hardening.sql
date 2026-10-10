-- Follow-up hardening for the initial Aivanta schema.
alter table public.workflows alter column created_by drop not null;
create index if not exists workspaces_owner_id_idx on public.workspaces(owner_id);
create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists workflows_created_by_idx on public.workflows(created_by);
create index if not exists workflow_versions_created_by_idx on public.workflow_versions(created_by);
create index if not exists audit_events_actor_user_id_idx on public.audit_events(actor_user_id);
revoke all on function public.set_updated_at() from public,anon,authenticated;
