-- Atomic workspace connection revocation.
-- Deleting the metadata row cascades to workspace_integration_secrets, removing
-- the encrypted credential in the same transaction.

create or replace function public.revoke_workspace_integration_connection(
  p_workspace_id uuid,
  p_connection_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connection public.workspace_integrations%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_connection_id is null or p_actor_id is null then
    raise exception 'INTEGRATION_REQUEST_INVALID' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = p_actor_id
  ) and not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_id
      and wm.role in ('owner','admin')
  ) then
    raise exception 'INTEGRATION_PERMISSION_DENIED' using errcode = '42501';
  end if;

  select wi.* into v_connection
    from public.workspace_integrations wi
   where wi.id = p_connection_id
     and wi.workspace_id = p_workspace_id
   for update;

  if not found then
    raise exception 'INTEGRATION_CONNECTION_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.workspace_integrations
   where id = v_connection.id
     and workspace_id = p_workspace_id;

  if not found then
    raise exception 'INTEGRATION_CONNECTION_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'success', true,
    'disconnected', true,
    'provider', v_connection.provider,
    'display_name', v_connection.display_name
  );
end;
$$;

revoke all on function public.revoke_workspace_integration_connection(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_workspace_integration_connection(uuid,uuid,uuid)
  to service_role;
