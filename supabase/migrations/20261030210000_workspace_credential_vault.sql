-- Workspace-scoped integration credential vault.
-- Ciphertext is written by trusted server code only; client roles have no table privileges.
create table if not exists public.workspace_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  secret_ciphertext bytea not null check (octet_length(secret_ciphertext) >= 30),
  secret_key_version text not null check (length(trim(secret_key_version)) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_credentials_workspace_provider_name_unique
    unique (workspace_id, provider, display_name)
);

create index if not exists workspace_credentials_workspace_provider_idx
  on public.workspace_credentials (workspace_id, provider, status);

drop trigger if exists workspace_credentials_set_updated_at on public.workspace_credentials;
create trigger workspace_credentials_set_updated_at
  before update on public.workspace_credentials
  for each row execute function public.set_updated_at();

alter table public.workspace_credentials enable row level security;
-- No authenticated policies and no client grants: decrypted values never pass through PostgREST.
revoke all on public.workspace_credentials from public, anon, authenticated;
grant all on public.workspace_credentials to service_role;

comment on table public.workspace_credentials is
  'Encrypted workspace integration secrets. Only trusted server-side service_role may access ciphertext.';
comment on column public.workspace_credentials.secret_ciphertext is
  'AES-256-GCM envelope produced by lib/credentials/secret-crypto.ts; never plaintext.';
