-- Aivanta workspace/workflow schema. All exposed tables use RLS.
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.workspaces (
 id uuid primary key default gen_random_uuid(),
 name varchar(120) not null check (char_length(trim(name)) between 1 and 120),
 owner_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.workspace_members (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'member' check (role in ('owner','admin','member')),
 created_at timestamptz not null default now(),
 primary key (workspace_id,user_id)
);
create table if not exists public.workflows (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 name varchar(80) not null check (char_length(trim(name)) between 1 and 80),
 description varchar(500) not null default '',
 definition jsonb not null default '{}'::jsonb check (jsonb_typeof(definition) = 'object'),
 status text not null default 'draft' check (status in ('draft','active','paused','archived')),
 version integer not null default 1 check (version > 0),
 created_by uuid default auth.uid() references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists workflows_workspace_updated_idx on public.workflows(workspace_id,updated_at desc);
create table if not exists public.workflow_versions (
 id uuid primary key default gen_random_uuid(),
 workflow_id uuid not null references public.workflows(id) on delete cascade,
 version integer not null check (version > 0),
 definition jsonb not null check (jsonb_typeof(definition) = 'object'),
 created_by uuid default auth.uid() references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(workflow_id,version)
);
create index if not exists workflow_versions_workflow_created_idx on public.workflow_versions(workflow_id,created_at desc);
create table if not exists public.audit_events (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_user_id uuid default auth.uid() references auth.users(id) on delete set null,
 event_type varchar(100) not null,
 resource_type varchar(80) not null,
 resource_id text,
 metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
 created_at timestamptz not null default now()
);
create index if not exists audit_events_workspace_created_idx on public.audit_events(workspace_id,created_at desc);

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select auth.uid() is not null and (
 exists(select 1 from public.workspaces w where w.id=target_workspace_id and w.owner_id=auth.uid())
 or exists(select 1 from public.workspace_members wm where wm.workspace_id=target_workspace_id and wm.user_id=auth.uid())
); $$;
create or replace function private.is_workspace_owner(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select auth.uid() is not null and exists(
 select 1 from public.workspaces w where w.id=target_workspace_id and w.owner_id=auth.uid()
); $$;
revoke all on function private.is_workspace_member(uuid) from public,anon;
revoke all on function private.is_workspace_owner(uuid) from public,anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path=''
as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
drop trigger if exists workflows_set_updated_at on public.workflows;
create trigger workflows_set_updated_at before update on public.workflows for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.audit_events enable row level security;

create policy "workspace members can read workspaces" on public.workspaces for select to authenticated using(private.is_workspace_member(id));
create policy "users can create owned workspaces" on public.workspaces for insert to authenticated with check(owner_id=(select auth.uid()));
create policy "workspace owners can update workspaces" on public.workspaces for update to authenticated using(private.is_workspace_owner(id)) with check(private.is_workspace_owner(id) and owner_id=(select auth.uid()));
create policy "workspace owners can delete workspaces" on public.workspaces for delete to authenticated using(private.is_workspace_owner(id));

create policy "members can read workspace membership" on public.workspace_members for select to authenticated using(private.is_workspace_member(workspace_id));
create policy "workspace owners can add members" on public.workspace_members for insert to authenticated with check(private.is_workspace_owner(workspace_id));
create policy "workspace owners can update members" on public.workspace_members for update to authenticated using(private.is_workspace_owner(workspace_id)) with check(private.is_workspace_owner(workspace_id));
create policy "workspace owners can remove members" on public.workspace_members for delete to authenticated using(private.is_workspace_owner(workspace_id));

create policy "members can read workflows" on public.workflows for select to authenticated using(private.is_workspace_member(workspace_id));
create policy "members can create workflows" on public.workflows for insert to authenticated with check(private.is_workspace_member(workspace_id) and created_by=(select auth.uid()));
create policy "members can update workflows" on public.workflows for update to authenticated using(private.is_workspace_member(workspace_id)) with check(private.is_workspace_member(workspace_id));
create policy "members can delete workflows" on public.workflows for delete to authenticated using(private.is_workspace_member(workspace_id));

create policy "members can read workflow versions" on public.workflow_versions for select to authenticated using(exists(select 1 from public.workflows wf where wf.id=workflow_id and private.is_workspace_member(wf.workspace_id)));
create policy "members can create workflow versions" on public.workflow_versions for insert to authenticated with check(created_by=(select auth.uid()) and exists(select 1 from public.workflows wf where wf.id=workflow_id and private.is_workspace_member(wf.workspace_id)));

create policy "members can read audit events" on public.audit_events for select to authenticated using(private.is_workspace_member(workspace_id));
create policy "members can create audit events" on public.audit_events for insert to authenticated with check(private.is_workspace_member(workspace_id) and actor_user_id=(select auth.uid()));

revoke all on public.workspaces,public.workspace_members,public.workflows,public.workflow_versions,public.audit_events from anon;
grant select,insert,update,delete on public.workspaces to authenticated;
grant select,insert,update,delete on public.workspace_members to authenticated;
grant select,insert,update,delete on public.workflows to authenticated;
grant select,insert on public.workflow_versions to authenticated;
grant select,insert on public.audit_events to authenticated;
