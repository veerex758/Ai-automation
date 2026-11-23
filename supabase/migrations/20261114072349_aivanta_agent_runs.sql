-- Phase 4: durable, inspectable agent model runs.
create table if not exists public.agent_runs (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 agent_id uuid not null references public.agents(id) on delete cascade,
 actor_user_id uuid references auth.users(id) on delete set null,
 status text not null check (status in ('running','completed','failed')),
 input text not null check (char_length(input)<=12000),
 output text,
 model_provider text not null check (model_provider in ('gemini','openai')),
 model_name text not null,
 error_code varchar(80),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists agent_runs_workspace_created_idx on public.agent_runs(workspace_id,created_at desc);
create index if not exists agent_runs_agent_created_idx on public.agent_runs(agent_id,created_at desc);
alter table public.agent_runs enable row level security;
drop policy if exists agent_runs_workspace_select on public.agent_runs;
create policy agent_runs_workspace_select on public.agent_runs for select to authenticated using (private.is_workspace_member(workspace_id));
drop policy if exists agent_runs_workspace_insert on public.agent_runs;
create policy agent_runs_workspace_insert on public.agent_runs for insert to authenticated with check (private.is_workspace_member(workspace_id) and actor_user_id=auth.uid());
drop policy if exists agent_runs_workspace_update on public.agent_runs;
create policy agent_runs_workspace_update on public.agent_runs for update to authenticated using (private.is_workspace_member(workspace_id) and actor_user_id=auth.uid()) with check (private.is_workspace_member(workspace_id) and actor_user_id=auth.uid());
grant select,insert,update on public.agent_runs to authenticated;
revoke all on public.agent_runs from anon;
