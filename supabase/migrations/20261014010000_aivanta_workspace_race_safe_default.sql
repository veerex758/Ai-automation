-- Serialize default-workspace recovery per authenticated user so concurrent
-- requests cannot create competing "default" workspaces or race membership repair.
create or replace function public.get_or_create_default_workspace()
returns table (id uuid, name varchar(120))
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  workspace_id uuid;
  workspace_name varchar(120);
  display_name text;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  -- Transaction-scoped lock: concurrent calls for this user serialize, while
  -- unrelated users continue independently. Hash collisions only add waiting.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 0)
  );

  select w.id, w.name
    into workspace_id, workspace_name
    from public.workspaces as w
   where w.owner_id = current_user_id
   order by w.created_at asc, w.id asc
   limit 1;

  if workspace_id is null then
    display_name := coalesce(
      nullif(
        pg_catalog.left(
          pg_catalog.btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', '')),
          100
        ),
        ''
      ),
      'My'
    );

    insert into public.workspaces (name, owner_id)
    values (pg_catalog.left(display_name || '''s workspace', 120), current_user_id)
    returning workspaces.id, workspaces.name
      into workspace_id, workspace_name;
  end if;

  -- Repair a missing owner-membership row safely if two requests reach this
  -- path after legacy/manual data changes; the composite primary key deduplicates.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace_id, current_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return query select workspace_id, workspace_name;
end;
$$;

revoke all on function public.get_or_create_default_workspace() from public, anon;
grant execute on function public.get_or_create_default_workspace() to authenticated;
