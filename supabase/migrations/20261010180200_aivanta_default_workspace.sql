-- Create one starter workspace for each newly registered Aivanta user.
-- Keep the trigger helper private and restrict direct execution.
create or replace function private.create_default_workspace_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  workspace_label text;
begin
  workspace_label := coalesce(
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 100), ''),
    'My'
  ) || '''s workspace';

  insert into public.workspaces (name, owner_id)
  values (left(workspace_label, 120), new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function private.create_default_workspace_for_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_create_workspace on auth.users;
create trigger on_auth_user_created_create_workspace
after insert on auth.users
for each row execute function private.create_default_workspace_for_new_user();
