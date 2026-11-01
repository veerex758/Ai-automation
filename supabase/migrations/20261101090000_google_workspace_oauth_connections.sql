-- Workspace-scoped Google OAuth connections for read-only Gmail and Sheets nodes.
create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product text not null check (product in ('gmail','sheets')),
  account_email text not null,
  encrypted_credentials text not null,
  scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected','needs_reauth')),
  expires_at timestamptz,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
);
create unique index if not exists google_connections_workspace_product_unique_idx
  on public.google_connections(workspace_id, product);
alter table public.google_connections enable row level security;
create policy "workspace members can read Google connection status"
  on public.google_connections for select to authenticated
  using (private.is_workspace_member(workspace_id));
revoke all on public.google_connections from public, anon, authenticated;
grant select on public.google_connections to authenticated;
grant all on public.google_connections to service_role;
