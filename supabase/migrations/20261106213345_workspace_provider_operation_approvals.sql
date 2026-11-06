-- Durable, append-only workspace decisions for provider operation execution.
-- No client role can read or write this table. The authenticated API checks
-- workspace ownership/admin membership and writes through the service role;
-- the worker reads the latest decision immediately before each live handler.
create table if not exists public.workspace_provider_operation_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{0,63}$'),
  node_id text not null check (node_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  operation_id text not null check (operation_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  decision text not null check (decision in ('approved', 'revoked')),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now(),
  reason text check (reason is null or length(reason) <= 500)
);

create index if not exists workspace_provider_operation_approvals_latest_idx
  on public.workspace_provider_operation_approvals
  (workspace_id, provider, node_id, operation_id, decided_at desc, id desc);

alter table public.workspace_provider_operation_approvals enable row level security;
revoke all on table public.workspace_provider_operation_approvals from public, anon, authenticated;
revoke update, delete, truncate on table public.workspace_provider_operation_approvals from service_role;
grant select, i¶»§q«^