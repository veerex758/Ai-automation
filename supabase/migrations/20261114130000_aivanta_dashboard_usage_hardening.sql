-- Saved workspace dashboards and atomic quota accounting hardening.
create table if not exists public.workspace_dashboards (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete restrict,
 name text not null check (char_length(trim(name)) between 1 and 100),
 description text not null default '' check (char_length(description) <= 500),
 layout text not null default 'two_column' check (layout in ('one_column','two_column','three_column')),
 widgets jsonb not null default '[]'::jsonb check (jsonb_typeof(widgets)='array' and jsonb_array_length(widgets)<=12),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists workspace_dashboards_workspace_updated_idx on public.workspace_dashboards(workspace_id,updated_at desc);
alter table public.workspace_dashboards enable row level security;
drop policy if exists workspace_dashboards_member_read on public.workspace_dashboards;
create policy workspace_dashboards_member_read on public.workspace_dashboards for select to authenticated using (private.is_workspace_member(workspace_id));
drop policy if exists workspace_dashboards_member_insert on public.workspace_dashboards;
create policy workspace_dashboards_member_insert on public.workspace_dashboards for insert to authenticated with check (private.is_workspace_member(workspace_id) and created_by=auth.uid());
drop policy if exists workspace_dashboards_creator_update on public.workspace_dashboards;
create policy workspace_dashboards_creator_update on public.workspace_dashboards for update to authenticated using (private.is_workspace_member(workspace_id) and created_by=auth.uid()) with check (private.is_workspace_member(workspace_id) and created_by=auth.uid());
drop policy if exists workspace_dashboards_creator_delete on public.workspace_dashboards;
create policy workspace_dashboards_creator_delete on public.workspace_dashboards for delete to authenticated using (private.is_workspace_member(workspace_id) and created_by=auth.uid());
grant select,insert,update,delete on public.workspace_dashboards to authenticated;
revoke all on public.workspace_dashboards from anon;

-- Serialize quota consumption per workspace/metric so concurrent requests cannot overrun a limit.
create or replace function public.consume_workspace_usage(p_workspace_id uuid,p_metric text,p_quantity integer default 1,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_plan text:='free'; v_status text:='active'; v_period date:=date_trunc('month',now())::date; v_used bigint:=0; v_limit bigint; v_actor uuid:=auth.uid(); v_key text:=nullif(coalesce(p_metadata,'{}'::jsonb)->>'idempotency_key',''); v_custom_workflows integer; v_custom_executions integer; v_custom_ai integer;
begin
 if v_actor is null or not private.is_workspace_member(p_workspace_id) then raise exception 'workspace access denied' using errcode='42501'; end if;
 if p_metric not in ('workflow_created','workflow_execution','ai_credit','agent_run','ai_generation') or p_quantity<1 or p_quantity>100 or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb))<>'object' then raise exception 'invalid usage request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,0));
 if v_key is not null and exists(select 1 from public.workspace_usage where workspace_id=p_workspace_id and metric=p_metric and metadata->>'idempotency_key'=v_key) then
  select coalesce(sum(quantity),0) into v_used from public.workspace_usage where workspace_id=p_workspace_id and period_start=v_period and metric=p_metric;
  return jsonb_build_object('allowed',true,'duplicate',true,'metric',p_metric,'used',v_used);
 end if;
 select plan_key,status,custom_workflow_limit,custom_execution_limit,custom_ai_credit_limit into v_plan,v_status,v_custom_workflows,v_custom_executions,v_custom_ai from public.workspace_subscriptions where workspace_id=p_workspace_id for update;
 v_plan:=coalesce(v_plan,'free'); v_status:=coalesce(v_status,'active'); v_period:=date_trunc('month',now())::date;
 if v_status not in ('active','trialing') then return jsonb_build_object('allowed',false,'reason','subscription_inactive','plan',v_plan); end if;
 v_limit:=case v_plan when 'starter' then case p_metric when 'workflow_created' then 10 when 'workflow_execution' then 2000 when 'ai_credit' then 500 else 500 end when 'pro' then case p_metric when 'workflow_created' then 50 when 'workflow_execution' then 10000 when 'ai_credit' then 2500 else 2500 end when 'business' then case p_metric when 'workflow_created' then 200 when 'workflow_execution' then 50000 when 'ai_credit' then 15000 else 15000 end when 'enterprise' then case p_metric when 'workflow_created' then v_custom_workflows when 'workflow_execution' then v_custom_executions else v_custom_ai end else case p_metric when 'workflow_created' then 2 when 'workflow_execution' then 300 when 'ai_credit' then 25 else 25 end end;
 if v_limit is null then return jsonb_build_object('allowed',false,'reason','enterprise_limits_not_configured','plan',v_plan); end if;
 if p_metric='workflow_created' then select count(*) into v_used from public.workflows where workspace_id=p_workspace_id and status='active';
 else select coalesce(sum(quantity),0) into v_used from public.workspace_usage where workspace_id=p_workspace_id and period_start=v_period and metric=p_metric; end if;
 if v_used+p_quantity>v_limit then return jsonb_build_object('allowed',false,'reason','limit_reached','metric',p_metric,'used',v_used,'limit',v_limit,'plan',v_plan); end if;
 insert into public.workspace_usage(workspace_id,metric,quantity,period_start,actor_user_id,metadata) values(p_workspace_id,p_metric,p_quantity,v_period,v_actor,coalesce(p_metadata,'{}'::jsonb));
 return jsonb_build_object('allowed',true,'duplicate',false,'metric',p_metric,'used',v_used+p_quantity,'limit',v_limit,'plan',v_plan);
end $$;
revoke all on function public.consume_workspace_usage(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.consume_workspace_usage(uuid,text,integer,jsonb) to authenticated;

create or replace function public.get_workspace_entitlements(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_plan text:='free'; v_status text:='active'; v_start date:=date_trunc('month',now())::date; v_workflows bigint:=0; v_exec bigint:=0; v_ai bigint:=0; v_agents bigint:=0; v_generations bigint:=0; v_workflow_limit integer:=2; v_execution_limit integer:=300; v_ai_limit integer:=25;
begin
 if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then raise exception 'workspace access denied' using errcode='42501'; end if;
 select plan_key,status,custom_workflow_limit,custom_execution_limit,custom_ai_credit_limit into v_plan,v_status,v_workflow_limit,v_execution_limit,v_ai_limit from public.workspace_subscriptions where workspace_id=p_workspace_id;
 v_plan:=coalesce(v_plan,'free'); v_status:=coalesce(v_status,'active'); v_start:=date_trunc('month',now())::date;
 if v_plan<>'enterprise' then v_workflow_limit:=case v_plan when 'starter' then 10 when 'pro' then 50 when 'business' then 200 else 2 end; v_execution_limit:=case v_plan when 'starter' then 2000 when 'pro' then 10000 when 'business' then 50000 else 300 end; v_ai_limit:=case v_plan when 'starter' then 500 when 'pro' then 2500 when 'business' then 15000 else 25 end; end if;
 select count(*) into v_workflows from public.workflows where workspace_id=p_workspace_id and status='active';
 select coalesce(sum(quantity) filter(where metric='workflow_execution'),0),coalesce(sum(quantity) filter(where metric='ai_credit'),0),coalesce(sum(quantity) filter(where metric='agent_run'),0),coalesce(sum(quantity) filter(where metric='ai_generation'),0) into v_exec,v_ai,v_agents,v_generations from public.workspace_usage where workspace_id=p_workspace_id and period_start=v_start;
 return jsonb_build_object('plan',v_plan,'status',v_status,'period_start',v_start,'usage',jsonb_build_object('workflow_created',v_workflows,'workflow_execution',v_exec,'ai_credit',v_ai,'agent_run',v_agents,'ai_generation',v_generations),'limits',jsonb_build_object('workflow_created',v_workflow_limit,'workflow_execution',v_execution_limit,'ai_credit',v_ai_limit,'agent_run',v_ai_limit,'ai_generation',v_ai_limit),'billing',jsonb_build_object('provider_connected',exists(select 1 from public.workspace_subscriptions where workspace_id=p_workspace_id and billing_provider is not null),'checkout_enabled',false));
end $$;
revoke all on function public.get_workspace_entitlements(uuid) from public,anon;
grant execute on function public.get_workspace_entitlements(uuid) to authenticated;
-- Reserve one agent run and one AI credit in the same transaction.
create or replace function public.consume_agent_run_usage(p_workspace_id uuid,p_agent_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 v_plan text:='free'; v_status text:='active'; v_custom_ai integer; v_limit integer;
 v_agents bigint:=0; v_credits bigint:=0; v_period date:=date_trunc('month',now())::date; v_actor uuid:=auth.uid();
begin
 if v_actor is null or not private.is_workspace_member(p_workspace_id) then raise exception 'workspace access denied' using errcode='42501'; end if;
 if p_agent_id is null or p_idempotency_key is null or length(p_idempotency_key)<8 or length(p_idempotency_key)>128 then raise exception 'invalid agent usage request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,0));
 if exists(select 1 from public.workspace_usage where workspace_id=p_workspace_id and metric='agent_run' and metadata->>'idempotency_key'=p_idempotency_key) then
  return jsonb_build_object('allowed',true,'duplicate',true);
 end if;
 select plan_key,status,custom_ai_credit_limit into v_plan,v_status,v_custom_ai from public.workspace_subscriptions where workspace_id=p_workspace_id for update;
 v_plan:=coalesce(v_plan,'free'); v_status:=coalesce(v_status,'active');
 if v_status not in ('active','trialing') then return jsonb_build_object('allowed',false,'reason','subscription_inactive'); end if;
 v_limit:=case v_plan when 'starter' then 500 when 'pro' then 2500 when 'business' then 15000 when 'enterprise' then v_custom_ai else 25 end;
 if v_limit is null then return jsonb_build_object('allowed',false,'reason','enterprise_limits_not_configured'); end if;
 select coalesce(sum(quantity),0) into v_agents from public.workspace_usage where workspace_id=p_workspace_id and period_start=v_period and metric='agent_run';
 select coalesce(sum(quantity),0) into v_credits from public.workspace_usage where workspace_id=p_workspace_id and period_start=v_period and metric='ai_credit';
 if v_agents+1>v_limit or v_credits+1>v_limit then
  return jsonb_build_object('allowed',false,'reason','limit_reached','agent_runs_used',v_agents,'ai_credits_used',v_credits,'limit',v_limit,'plan',v_plan);
 end if;
 insert into public.workspace_usage(workspace_id,metric,quantity,period_start,actor_user_id,metadata)
 values
 (p_workspace_id,'agent_run',1,v_period,v_actor,jsonb_build_object('feature','agent_run','agent_id',p_agent_id,'idempotency_key',p_idempotency_key)),
 (p_workspace_id,'ai_credit',1,v_period,v_actor,jsonb_build_object('feature','agent_run','agent_id',p_agent_id,'idempotency_key',p_idempotency_key));
 return jsonb_build_object('allowed',true,'agent_runs_used',v_agents+1,'ai_credits_used',v_credits+1,'limit',v_limit,'plan',v_plan);
end $$;
revoke all on function public.consume_agent_run_usage(uuid,uuid,text) from public,anon;
grant execute on function public.consume_agent_run_usage(uuid,uuid,text) to authenticated;

-- Server-owned worker heartbeat registry for operational diagnostics.
create table if not exists public.execution_worker_heartbeats (
  worker_id text primary key check (length(worker_id) between 1 and 100),
  status text not null check (status in ('polling','processing','idle','error')),
  current_job_id uuid references public.execution_jobs(id) on delete set null,
  last_error_code text,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.execution_worker_heartbeats enable row level security;
revoke all on public.execution_worker_heartbeats from public,anon,authenticated;
grant all on public.execution_worker_heartbeats to service_role;

create or replace function public.record_execution_worker_heartbeat(
  p_worker_id text,p_status text,p_job_id uuid default null,p_error_code text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 if p_worker_id is null or length(p_worker_id) not between 1 and 100
   or p_status not in ('polling','processing','idle','error')
   or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{1,80}$') then
  raise exception 'invalid worker heartbeat' using errcode='22023';
 end if;
 insert into public.execution_worker_heartbeats(worker_id,status,current_job_id,last_error_code,last_seen_at,updated_at)
 values(p_worker_id,p_status,p_job_id,p_error_code,now(),now())
 on conflict(worker_id) do update set status=excluded.status,current_job_id=excluded.current_job_id,
   last_error_code=excluded.last_error_code,last_seen_at=now(),updated_at=now();
end $$;
revoke all on function public.record_execution_worker_heartbeat(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.record_execution_worker_heartbeat(text,text,uuid,text) to service_role;

-- Atomic workspace creation: create the workspace and its owner membership together.
create or replace function public.create_workspace_for_current_user(p_name text)
returns table(id uuid,name text)
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
 if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
 if p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'invalid workspace name' using errcode='22023'; end if;
 insert into public.workspaces(name,owner_id) values(trim(p_name),v_user) returning workspaces.id into v_id;
 insert into public.workspace_members(workspace_id,user_id,role) values(v_id,v_user,'owner');
 return query select w.id,w.name from public.workspaces w where w.id=v_id;
end $$;
revoke all on function public.create_workspace_for_current_user(text) from public,anon;
grant execute on function public.create_workspace_for_current_user(text) to authenticated;
