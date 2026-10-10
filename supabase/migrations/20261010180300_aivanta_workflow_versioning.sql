-- Save workflow definitions and their history atomically under the caller's RLS permissions.
create or replace function public.save_workflow_definition(
  p_workflow_id uuid,
  p_definition jsonb
)
returns table (saved_workflow_id uuid, saved_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_workflow public.workflows%rowtype;
  next_version integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_definition is null or pg_catalog.jsonb_typeof(p_definition) <> 'object' then
    raise exception 'Workflow definition must be a JSON object' using errcode = '22023';
  end if;

  select wf.*
    into current_workflow
    from public.workflows as wf
   where wf.id = p_workflow_id
   for update;

  if not found then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;

  next_version := current_workflow.version + 1;

  update public.workflows as wf
     set definition = p_definition,
         version = next_version
   where wf.id = p_workflow_id;

  insert into public.workflow_versions (workflow_id, version, definition, created_by)
  values (p_workflow_id, next_version, p_definition, auth.uid());

  insert into public.audit_events (workspace_id, actor_user_id, event_type, resource_type, resource_id, metadata)
  values (
    current_workflow.workspace_id,
    auth.uid(),
    'workflow.definition_saved',
    'workflow',
    p_workflow_id::text,
    pg_catalog.jsonb_build_object('version', next_version, 'step_count', pg_catalog.jsonb_array_length(coalesce(p_definition -> 'nodes', '[]'::jsonb)))
  );

  return query select p_workflow_id, next_version;
end;
$$;

revoke all on function public.save_workflow_definition(uuid, jsonb) from public, anon;
grant execute on function public.save_workflow_definition(uuid, jsonb) to authenticated;
