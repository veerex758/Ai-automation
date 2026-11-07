-- Workspace members must not mutate installation ownership, status, version, or workflow linkage.
-- The service-role materializer owns workflow copying and lifecycle transitions.
revoke insert, update on public.marketplace_installations from authenticated;
grant select on public.marketplace_installations to authenticated;

drop policy if exists marketplace_installations_workspace_insert on public.marketplace_installations;
drop policy if exists marketplace_installations_workspace_update on public.marketplace_installations;

-- Revoke direct execution of lifecycle RPC from anon/public; only authenticated users
-- may request the entitlement-aware install transition (which validates workspace membership).
revoke all on function public.marketplace_install_product(uuid,uuid) from public,anon;
grant execute on function public.marketplace_install_product(uuid,uuid) to authenticated;

-- Only service role can materialize a workflow from the verified artifact.
revoke all on function public.marketplace_materialize_installation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_materialize_installation(uuid,uuid,text) to service_role;
