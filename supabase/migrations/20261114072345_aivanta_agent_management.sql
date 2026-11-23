-- Phase 4: persistent, workspace-scoped AI agent management.
create table if not exists public.agents (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 name varchar(80) not null check (char_length(trim(name)) between 1 and 80),
 description varchar(500) not null default '',
 instructions text not null default '' check (char_length(instructions) <= 12000),
 model_provider text not null default 'gemini' check (model_provider in ('gemini','openai')),
 model_name varchar(120) not null default 'gemini-2.5-flash',
 tool_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_ids)='array' and jsonb_array_length(tool_ids)<=30),
 permissions jsonb not null default '{"mode":"draft","allow_external_actions":false}'::jsonb check (jsonb_typeof(permissions)='object'),
 status text not null default 'draft' check (status in ('draft','ready','paused')),
 created_by uuid default auth.uid() references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists agents_workspace_updated_idx on public.agents(workspace_id,updated_at desc);
alter table public.agents enable row level security;
drop policy if exists agents_workspace_member_select on public.agents;
create policy agents_workspace_member_select on public.agents for select to authenticated using (private.is_workspace_member(workspace_id));
drop policy if exists agents_workspace_member_insert on public.agents;
create policy agents_workspace_member_insert on public.agents for insert to authenticated with check (private.is_workspace_member(workspace_id) and created_by=auth.uid());
drop policy if exists agents_workspace_member_update on public.agents;
create policy agents_workspace_member_update on public.agents for update to authenticated using (private.is_workspace_member(workspace_id) and private.is_workspace_owner(workspace_id)) with check (private.is_workspace_member(workspace_id));
drop policy if exists agents_workspace_owner_delete on public.agents;
create policy agents_workspace_owner_delete on public.agents for delete to authenticated using (private.is_workspace_owner(workspace_id));
grant select,insert,update,delete on public.agents to authenticated;
revoke all on public.agents from anon;

create table if not exists public.agent_activity (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 agent_id uuid not null references public.agents(id) on delete cascade,
 actor_user_id uuid references auth.users(id) on delete set null,
 event_type varchar(80) not null,
 details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
 created_at timestamptz not null default now()
);
create index if not exists agent_activity_agent_created_idx on public.agent_activity(agent_id,created_at desc);
alter table public.agent_activity enable row level security;
drop policy if exists agent_activity_workspace_select on public.agent_activity;
create policy agent_activity_workspace_select on public.agent_activity for select to authenticated using (private.is_workspace_member(workspace_id));
drop policy if exists agent_activity_workspace_insert on public.agent_activity;
create policy agent_activity_workspace_insert on public.agent_activity for insert to authenticated with check (private.is_workspace_member(workspace_id) and actor_user_id=auth.uid());
grant select,insert on public.agent_activity to authenticated;
revoke update,delete,truncate, references,trigger on public.agent_activity from authenticated,anon;
revoke all on public.agent_activity from anon;
