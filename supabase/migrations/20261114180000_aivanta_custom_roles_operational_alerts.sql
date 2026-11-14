-- Custom workspace roles and configurable operational alert destinations.
create table if not exists public.workspace_custom_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 48),
  description text not null default '' check (length(description) <= 240),
  permissions jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_custom_roles_name_unique unique (workspace_id, name),
  constraint workspace_custom_roles_permissions_object check (jsonb_typeof(permissions) = 'object')
);
alter table public.workspace_members
  add column if not exists custom_role_id uuid references public.workspace_custom_roles(id) on delete set null;
create index if not exists workspace_custom_roles_workspace_idx on public.workspace_custom_roles(workspace_id);
create index if not exists workspace_members_custom_role_idx on public.workspace_members(custom_role_id);
alter table public.workspace_custom_roles enable row level security;
revoke all on public.workspace_custom_roles from public, anon, authenticated;
grant all on public.workspace_custom_roles to service_role;

create table if not exists public.workspace_alert_preferences (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default true,
  events text[] not null default array['queue_backlog','dead_letter','worker_offline','workflow_failures','provider_failure']::text[],
  minimum_severity text not null default 'warning' check (minimum_severity in ('warning','critical')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.workspace_alert_destinations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check (channel in ('email','slack')),
  destination text not null,
  encrypted_secret text,
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_alert_destinations_secret_check check (
    (channel = 'email' and encrypted_secret is null) or
    (channel = 'slack' and encrypted_secret is not null)
  )
);
create unique index if not exists workspace_alert_destination_unique
  on public.workspace_alert_destinations(workspace_id, channel, destination);
create index if not exists workspace_alert_destinations_workspace_idx
  on public.workspace_alert_destinations(workspace_id, enabled);
create table if not exists public.workspace_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  destination_id uuid references public.workspace_alert_destinations(id) on delete set null,
  event_key text not null,
  channel text not null check (channel in ('email','slack')),
  status text not null check (status in ('sent','failed','skipped')),
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists workspace_alert_deliveries_workspace_created_idx
  on public.workspace_alert_deliveries(workspace_id, created_at desc);
alter table public.workspace_alert_preferences enable row level security;
alter table public.workspace_alert_destinations enable row level security;
alter table public.workspace_alert_deliveries enable row level security;
revoke all on public.workspace_alert_preferences, public.workspace_alert_destinations, public.workspace_alert_deliveries from public, anon, authenticated;
grant all on public.workspace_alert_preferences, public.workspace_alert_destinations, public.workspace_alert_deliveries to service_role;

insert into public.workspace_alert_preferences(workspace_id)
select id from public.workspaces
on conflict(workspace_id) do nothing;

create or replace function private.create_workspace_alert_preferences()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.workspace_alert_preferences(workspace_id)
  values(new.id) on conflict(workspace_id) do nothing;
  return new;
end $$;
revoke all on function private.create_workspace_alert_preferences() from public, anon, authenticated;
drop trigger if exists workspaces_create_alert_preferences on public.workspaces;
create trigger workspaces_create_alert_preferences after insert on public.workspaces
for each row execute function private.create_workspace_alert_preferences();
