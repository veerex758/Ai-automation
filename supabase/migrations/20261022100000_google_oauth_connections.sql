-- Google OAuth connections. Tokens are encrypted by the application before storage.
-- Only the server-side service role may access this table; never expose token material
-- through the Supabase Data API or return it to a browser.
create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connected_by uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  account_email text not null,
  scopes text[] not null default '{}',
  encrypted_credentials text not null,
  expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'needs_reauth', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, account_email, connected_by)
);

create index if not exists google_connections_workspace_idx
  on public.google_connections (workspace_id, created_at desc);

alter table public.google_connections enable row level security;
revoke all on table public.google_connections from anon, authenticated;
grant all on table public.google_connections to service_role;

comment on table public.google_connections is
  'Server-only Google OAuth connections; encrypted credentials must never be selected by browser clients.';
