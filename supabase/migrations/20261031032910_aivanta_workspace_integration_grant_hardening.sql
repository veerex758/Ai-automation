-- Tighten workspace integration grants to the intended least-privilege model.
-- Metadata is available to authenticated users only through its workspace RLS policies.
-- Encrypted credentials remain service-role only.
revoke all privileges on table public.workspace_integrations
  from public, anon, authenticated;
revoke all privileges on table public.workspace_integration_secrets
  from public, anon, authenticated;

grant select, insert, update, delete on table public.workspace_integrations to authenticated;
grant all privileges on table public.workspace_integrations to service_role;
grant all privileges on table public.workspace_integration_secrets to service_role;
