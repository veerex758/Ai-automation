-- Isolated PostgreSQL fixture for the node installation migration.
-- This runs only in CI against the disposable postgres service.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create schema private;
grant usage on schema private to authenticated;

create table public.workspaces (
  id uuid primary key,
  owner_id uuid not null references auth.users(id)
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','admin','member')),
  primary key (workspace_id,user_id)
);
create function private.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = target_workspace_id and w.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = (select auth.uid())
  );
$$;
create function private.is_workspace_admin(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = target_workspace_id and w.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner','admin')
  );
$$;
revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.is_workspace_admin(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  actor_user_id uuid references auth.users(id),
  event_type varchar(100) not null,
  resource_type varchar(80) not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;
create policy audit_events_insert_member on public.audit_events
  for insert to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and actor_user_id = (select auth.uid())
  );
create policy audit_events_select_member on public.audit_events
  for select to authenticated
  using (private.is_workspace_member(workspace_id));
grant select, insert on public.audit_events to authenticated;
grant select on public.workspaces, public.workspace_members to authenticated;

create function public.set_updated_at()
returns trigger language plpgsql set search_path=''
as $$ begin new.updated_at = now(); return new; end; $$;

insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003');
insert into public.workspaces(id,owner_id) values
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002');
insert into public.workspace_members(workspace_id,user_id,role) values
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','member');

-- The migration is applied by the shell test after this fixture.
