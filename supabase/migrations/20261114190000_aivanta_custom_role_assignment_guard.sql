-- Prevent cross-workspace or privileged custom-role assignments at the database boundary.
create or replace function private.guard_workspace_custom_role_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role_workspace uuid;
begin
  if new.custom_role_id is null then return new; end if;
  if new.role is distinct from 'member' then
    raise exception 'custom roles may only be assigned to regular members' using errcode='23514';
  end if;
  select workspace_id into v_role_workspace
  from public.workspace_custom_roles
  where id = new.custom_role_id;
  if v_role_workspace is null or v_role_workspace <> new.workspace_id then
    raise exception 'custom role must belong to the same workspace' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_workspace_custom_role_assignment() from public,anon,authenticated;
drop trigger if exists workspace_members_custom_role_guard on public.workspace_members;
create trigger workspace_members_custom_role_guard
before insert or update of custom_role_id,workspace_id,role on public.workspace_members
for each row execute function private.guard_workspace_custom_role_assignment();
