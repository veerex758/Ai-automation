-- Align workspace membership semantics with the canonical schema.
-- Workspace ownership is sufficient for membership even if a membership row is missing.
create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.workspaces w
      where w.id = target_workspace_id
        and w.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = target_workspace_id
        and wm.user_id = auth.uid()
    )
  );
$$;

create or replace function private.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace_id
      and w.owner_id = auth.uid()
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.is_workspace_owner(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;
