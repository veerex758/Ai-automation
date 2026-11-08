-- Installation records are privileged state: never allow a workspace member to bypass
-- product entitlement, version verification, or configuration checks with direct INSERT/UPDATE.
drop policy if exists marketplace_installations_workspace_insert on public.marketplace_installations;
drop policy if exists marketplace_installations_workspace_update on public.marketplace_installations;
revoke insert,update,delete,truncate,references,trigger on public.marketplace_installations from authenticated,anon;
revoke all on public.marketplace_installations from authenticated;
grant select on public.marketplace_installations to authenticated;
-- Service role performs entitlement-checked install, activate, pause, and removal transitions.
