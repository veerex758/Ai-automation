-- Tighten workflow saves: require a trigger and start history at version 1.
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
  node_value jsonb;
  node_id text;
  node_type text;
  node_title text;
  node_description text;
  node_ids text[] := array[]::text[];
  trigger_count integer := 0;
  node_position integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_definition is null
     or pg_catalog.jsonb_typeof(p_definition) <> 'object'
     or p_definition ->> 'version' is distinct from '1'
     or pg_catalog.jsonb_typeof(p_definition -> 'nodes') is distinct from 'array' then
    raise exception 'Use workflow definition version 1 with a nodes array' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_definition -> 'nodes') = 0 then
    raise exception 'Add a trigger before saving this workflow' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_definition -> 'nodes') > 30 then
    raise exception 'A workflow can contain at most 30 steps' using errcode = '22023';
  end if;

  for node_value in
    select element.value
      from pg_catalog.jsonb_array_elements(p_definition -> 'nodes') with ordinality as element(value, position)
     order by element.position
  loop
    node_position := node_position + 1;
    if pg_catalog.jsonb_typeof(node_value) <> 'object' then
      raise exception 'Each workflow step must be an object' using errcode = '22023';
    end if;

    node_id := node_value ->> 'id';
    node_type := node_value ->> 'type';
    node_title := pg_catalog.btrim(node_value ->> 'title');
    node_description := pg_catalog.btrim(node_value ->> 'description');

    if node_id is null or node_id !~ '^[a-zA-Z0-9_-]{1,64}$' or node_id = any(node_ids) then
      raise exception 'Each step needs a unique, valid ID' using errcode = '22023';
    end if;
    if node_type is null or node_type not in ('trigger', 'action', 'condition') then
      raise exception 'Each step must be a trigger, action, or condition' using errcode = '22023';
    end if;
    if node_title is null or pg_catalog.char_length(node_title) < 1 or pg_catalog.char_length(node_title) > 80 then
      raise exception 'Step titles must be between 1 and 80 characters' using errcode = '22023';
    end if;
    if node_description is null or pg_catalog.char_length(node_description) > 240 then
      raise exception 'Step descriptions cannot exceed 240 characters' using errcode = '22023';
    end if;

    if node_type = 'trigger' then
      trigger_count := trigger_count + 1;
      if node_position <> 1 then
        raise exception 'The first step must be a trigger' using errcode = '22023';
      end if;
    end if;
    if node_position = 1 and node_type <> 'trigger' then
      raise exception 'The first step must be a trigger' using errcode = '22023';
    end if;
    node_ids := pg_catalog.array_append(node_ids, node_id);
  end loop;

  if trigger_count > 1 then
    raise exception 'A workflow can only have one trigger' using errcode = '22023';
  end if;

  select wf.*
    into current_workflow
    from public.workflows as wf
   where wf.id = p_workflow_id
   for update;

  if not found then
    raise exception 'Workflow not found or access denied' using errcode = 'P0002';
  end if;

  select coalesce(pg_catalog.max(version) + 1, 1)
    into next_version
    from public.workflow_versions
   where workflow_id = p_workflow_id;

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
    pg_catalog.jsonb_build_object('version', next_version, 'step_count', pg_catalog.jsonb_array_length(p_definition -> 'nodes'))
  );

  return query select p_workflow_id, next_version;
end;
$$;

revoke all on function public.save_workflow_definition(uuid, jsonb) from public, anon;
grant execute on function public.save_workflow_definition(uuid, jsonb) to authenticated;
