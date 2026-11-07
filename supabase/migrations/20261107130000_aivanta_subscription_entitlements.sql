-- Phase 5: persisted workspace subscription entitlements and atomic usage metering.
create table if not exists public.workspace_subscriptions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
 plan_key text not null default 'free' check (plan_key in ('free','starter','pro','business')),
 status text not null default 'active' check (status in ('active','trialing','past_due','canceled','incomplete')),
 billing_provider text check (billing_provider in ('stripe','paystack','flutterwave')),
 provider_customer_id text,
 provider_subscription_id text,
 current_period_start timestamptz not null default date_trunc('month',now()),
 current_period_end timestamptz not null default (date_trunc('month',now()) + interval '1 month'),
 cancel_at_period_end boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists workspace_subscriptions_plan_status_idx on public.workspace_subscriptions(plan_key,status);
alter table public.workspace_subscriptions enable row level security;
drop policy if exists workspace_subscriptions_member_read on public.workspace_subscriptions;
create policy workspace_subscriptions_member_read on public.workspace_subscriptions for select to authenticated using (private.is_workspace_member(workspace_id));
grant select on public.workspace_subscriptions to authenticated;
revoke all on public.workspace_subscriptions from anon;
revoke insert,update,delete on public.workspace_subscriptions from authenticated;

create table if not exists public.workspace_usage (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 metric text not null check (metric in ('workflow_created','workflow_execution','ai_credit','agent_run','ai_generation')),
 quantity integer not null check (quantity > 0),
 period_start date not null default date_trunc('month',now())::date,
 actor_user_id uuid references auth.users(id) on delete set null,
 metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default now()
);
create index if not exists workspace_usage_period_metric_idx on public.workspace_usage(workspace_id,period_start,metric);
alter table public.workspace_usage enable row level security;
drop policy if exists workspace_usage_member_read on public.workspace_usage;
create policy workspace_usage_member_read on public.workspace_usage for select to authenticated using (private.is_workspace_member(workspace_id));
grant select on public.workspace_usage to authenticated;
revoke all on public.workspace_usage from anon,authenticated;
grant select on public.workspace_usage to authenticated;

-- Plan caps follow the approved Aivanta plan matrix: Free 2 active workflows / 300 executions / 25 AI credits;
-- Starter 10 / 2,000 / 500; Pro 50 / 10,000 / 2,500; Business 200 / 50,000 / 15,000.
create or replace function public.consume_workspace_usage(p_workspace_id uuid,p_metric text,p_quantity integer default 1,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 v_plan text := 'free';
 v_status text := 'active';
 v_period date := date_trunc('month',now())::date;
 v_used bigint := 0;
 v_limit bigint;
begin
 if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then
  raise exception 'workspace access denied' using errcode='42501';
 end if;
 if p_metric not in ('workflow_created','workflow_execution','ai_credit','agent_run','ai_generation') or p_quantity<1 or p_quantity>100 then
  raise exception 'invalid usage request' using errcode='22023';
 end if;
 select plan_key,status,current_period_start::date into v_plan,v_status,v_period
 from public.workspace_subscriptions where workspace_id=p_workspace_id;
 if v_status not in ('active','trialing') then
  return jsonb_build_object('allowed',false,'reason','subscription_inactive','plan',v_plan);
 end if;
 v_limit := case v_plan
  when 'starter' then case p_metric when 'workflow_created' then 10 when 'workflow_execution' then 2000 when 'ai_credit' then 500 else 500 end
  when 'pro' then case p_metric when 'workflow_created' then 50 when 'workflow_execution' then 10000 when 'ai_credit' then 2500 else 2500 end
  when 'business' then case p_metric when 'workflow_created' then 200 when 'workflow_execution' then 50000 when 'ai_credit' then 15000 else 15000 end
  else case p_metric when 'workflow_created' then 2 when 'workflow_execution' then 300 when 'ai_credit' then 25 else 25 end
 end;
 if p_metric='workflow_created' then
  select count(*) into v_used from public.workflows where workspace_id=p_workspace_id and status='active';
 else
  select coalesce(sum(quantity),0) into v_used from public.workspace_usage
   where workspace_id=p_workspace_id and period_start=date_trunc('month',now())::date and metric=p_metric;
 end if;
 if v_used+p_quantity>v_limit then
  return jsonb_build_object('allowed',false,'reason','limit_reached','metric',p_metric,'used',v_used,'limit',v_limit,'plan',v_plan);
 end if;
 insert into public.workspace_usage(workspace_id,metric,quantity,period_start,actor_user_id,metadata)
 values(p_workspace_id,p_metric,p_quantity,date_trunc('month',now())::date,auth.uid(),coalesce(p_metadata,'{}'::jsonb));
 return jsonb_build_object('allowed',true,'metric',p_metric,'used',v_used+p_quantity,'limit',v_limit,'plan',v_plan);
end $$;
revoke all on function public.consume_workspace_usage(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.consume_workspace_usage(uuid,text,integer,jsonb) to authenticated;

create or replace function public.get_workspace_entitlements(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_plan text := 'free'; v_status text := 'active'; v_start date := date_trunc('month',now())::date; v_workflows bigint; v_runs bigint; v_ai bigint;
begin
 if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then raise exception 'workspace access denied' using errcode='42501'; end if;
 select plan_key,status,current_period_start::date into v_plan,v_status,v_start from public.workspace_subscriptions where workspace_id=p_workspace_id;
 select count(*) into v_workflows from public.workflows where workspace_id=p_workspace_id and status='active';
 select coalesce(sum(quantity),0) into v_runs from public.workspace_usage where workspace_id=p_workspace_id and period_start=date_trunc('month',now())::date and metric='workflow_execution';
 select coalesce(sum(quantity),0) into v_ai from public.workspace_usage where workspace_id=p_workspace_id and period_start=date_trunc('month',now())::date and metric='ai_credit';
 return jsonb_build_object('plan',v_plan,'status',v_status,'period_start',v_start,'usage',jsonb_build_object('workflow_created',v_workflows,'workflow_execution',v_runs,'ai_credit',v_ai),'limits',jsonb_build_object('workflow_created',case v_plan when 'starter' then 10 when 'pro' then 50 when 'business' then 200 else 2 end,'workflow_execution',case v_plan when 'starter' then 2000 when 'pro' then 10000 when 'business' then 50000 else 300 end,'ai_credit',case v_plan when 'starter' then 500 when 'pro' then 2500 when 'business' then 15000 else 25 end,'agent_run',case v_plan when 'starter' then 500 when 'pro' then 2500 when 'business' then 15000 else 25 end,'ai_generation',case v_plan when 'starter' then 500 when 'pro' then 2500 when 'business' then 15000 else 25 end),'billing',jsonb_build_object('provider_connected',exists(select 1 from public.workspace_subscriptions where workspace_id=p_workspace_id and billing_provider is not null),'checkout_enabled',false));
end $$;
revoke all on function public.get_workspace_entitlements(uuid) from public,anon;
grant execute on function public.get_workspace_entitlements(uuid) to authenticated;
