-- Workspace integrations store non-sensitive connection metadata separately from encrypted secrets.
-- This migration is reversible: dropping these two new tables removes only this feature's data.
create table if not exists public.workspace_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('openai','gemini','resend','slack','http')),
  status text not null default 'connected' check (status in ('connected','needs_attention')),
  display_name varchar(120) not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  last_tested_at timestamptz,
  last_test_status text check (last_test_status in ('passed','failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table if not exists public.workspace_integration_secrets (
  integration_id uuid primary key references public.workspace_integrations(id) on delete cascade,
  encrypted_credentials text not null,
  encryption_version text not null default 'v1' check (encryption_version = 'v1'),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_integrations_workspace_idx
  on public.workspace_integrations(workspace_id, provider);

alter table public.workspace_integrations enable row level security;
alter table public.workspace_integration_secrets enable row level security;

create policy "workspace members can read integration metadata"
  on public.workspace_integrations for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "workspace owners can manage integration metadata"
  on public.workspace_integrations for all to authenticated
  using (private.is_workspace_owner(workspace_id))
  with check (private.is_workspace_owner(workspace_id) and created_by = (select auth.uid()));

revoke all on public.workspace_integrations from anon;
revoke all on public.workspace_integration_secrets from public, anon, authenticated;
grant select, insert, update, delete on public.workspace_integrations to authenticated;
grant all on public.workspace_integrations, public.workspace_integration_secrets to service_role;

-- No policy is intentionally created for authenticated users on the secret table.
-- Only the server's service-role client may read or write encrypted credentials.
