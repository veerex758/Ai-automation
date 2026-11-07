-- Phase 5 hardening: serialize usage reservations and enforce active workflow caps at write time.
-- This migration is additive and safe to replay on a clean database.

alter table public.workspace_subscriptions
  add column if not exists custom_workflow_limit integer check (custom_workflow_limit is null or custom_workflow_limit >= 0),
  add column if not exists custom_execution_limit integer check (custom_execution_limit is null or custom_execution_limit >= 0),
  add column if not exists custom_ai_credit_limit integer check (custom_ai_credit_limit is null or custom_ai_credit_limit >= 0);
alter table public.workspace_subscriptions drop constraint if exists workspace_subscriptions_plan_key_check;
alter table public.workspace_subscriptions
  add constraint workspace_subscriptions_plan_key_check
  check (plan_key in ('free','starter','pro','business','enterprise'));
alter table public.workspace_subscriptions drop constraint if exists workspace_subscriptions_enterprise_limits_check;
alter table public.workspace_subscriptions
  add constraint workspace_subscriptions_enterprise_limits_check
  check (plan_key <> 'enterprise' or (
    custom_workflow_limit is not null
    and custom_execution_limit is not null
    and custom_ai_credit_limit is not null
  ));

create unique index if not exists workspace_usage_idempotency_uidx
  on public.workspace_usage (workspace_id, metric, (metadata ->> 'idempotency_key'))
  where metadata ? 'idempotency_key';

create or replace function public.consume_workspace_usage(
  p_workspace_id uuid,
  p_metric text,
  p_quantity integer default 1,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_plan text := 'free';
  v_status text := 'active';
  v_used bigint := 0;
  v_limit bigint;
  v_period date := date_trunc('month',now())::date;
  v_metadata jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_idempotency_key text;
  v_custom_workflows integer;
  v_custom_executions integer;
  v_custom_ai_credits integer;
begin
  if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode='42501';
  end if;
  if p_workspace_id is null or p_metric is null
     or p_metric not in ('workflow_created','workflow_execution','ai_credit','agent_run','ai_generation')
     or p_quantity is null or p_quantity<1 or p_quantity>100
     or jsonb_typeof(v_metadata)<>'object' then
    raise exception 'invalid usage request' using errcode='22023';
  end if;

  -- Serialize all quota reads and writes within a workspace so concurrent requests
  -- cannot both observe the same remaining allowance and over-consume it.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,0));

  select plan_key,status,custom_workflow_limit,custom_execution_limit,custom_ai_credit_limit
    into v_plan,v_status,v_custom_workflows,v_custom_executions,v_custom_ai_credits
    from public.workspace_subscriptions where workspace_id=p_workspace_id;
  v_plan := coalesce(v_plan,'free');
  v_status := coalesce(v_status,'active');
  if v_status not in ('active','trialing') then
    return jsonb_build_object('allowed',false,'reason','subscription_inactive','plan',v_plan);
  end if;

  v_limit := case v_plan
    when 'starter' then case p_metric when 'workflow_created' then 10 when 'workflow_execution' then 2000 when 'ai_credit' then 500 else 500 end
    when 'pro' then case p_metric when 'workflow_created' then 50 when 'workflow_execution' then 10000 when 'ai_credit' then 2500 else 2500 end
    when 'business' then case p_metric when 'workflow_created' then 200 when 'workflow_execution' then 50000 when 'ai_credit' then 15000 else 15000 end
    when 'enterprise' then case p_metric when 'workflow_created' then v_custom_workflows when 'workflow_execution' then v_custom_executions when 'ai_credit' then v_custom_ai_credits else v_custom_ai_credits end
    else case p_metric when 'workflow_created' then 2 when 'workflow_execution' then 300 when 'ai_credit' then 25 else 25 end
  end;
  if v_limit is null then
    return jsonb_build_object('allowed',false,'reason','enterprise_limits_not_configured','plan',v_plan);
  end if;

  v_idempotency_key := nullif(v_metadata ->> 'idempotency_key','');
  if v_idempotency_key is not null and exists (
    select 1 from public.workspace_usage
    where workspace_id=p_workspace_id and metric=p_metric
      and metadata ->> 'idempotency_key'=v_idempotency_key
  ) then
    select coalesce(sum(quantity),0) into v_used
      from public.workspace_usage
      where workspace_id=p_workspace_id and period_start=v_period and metric=p_metric;
    return jsonb_build_object('allowed',true,'duplicate',true,'metric',p_metric,'used',v_used,'limit',v_limit,'plan',v_plan);
  end if;

  if p_metric='workflow_created' then
    select count(*) into v_used from public.workflows
      where workspace_id=p_workspace_id and status='active';
  else
    select coalesce(sum(quantity),0) into v_used from public.workspace_usage
      where workspace_id=p_workspace_id and period_start=v_period and metric=p_metric;
  end if;

  if v_used+p_quantity>v_limit then
    return jsonb_build_object('allowed',false,'reason','limit_reached','metric',p_metric,'used',v_used,'limit',v_limit,'plan',v_plan);
  end if;

  insert into public.workspace_usage(workspace_id,metric,quantity,period_start,actor_user_id,metadata)
    values(p_workspace_id,p_metric,p_quantity,v_period,auth.uid(),v_metadata);
  return jsonb_build_object('allowed',true,'metric',p_metric,'used',v_used+p_quantity,'limit',v_limit,'plan',v_plan);
end
$$;

revoke all on function public.consume_workspace_usage(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.consume_workspace_usage(uuid,text,integer,jsonb) to authenticated;

create or replace function private.enforce_active_workflow_entitlement()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_plan text := 'free';
  v_status text := 'active';
  v_limit integer;
  v_active bigint;
  v_custom_workflows integer;
begin
  if new.status <> 'active' then
    return new;
  end if;

  -- Hold the workspace lock through the workflow INSERT/UPDATE transaction.
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,0));

  select plan_key,status,custom_workflow_limit into v_plan,v_status,v_custom_workflows
    from public.workspace_subscriptions where workspace_id=new.workspace_id;
  v_plan := coalesce(v_plan,'free');
  v_status := coalesce(v_status,'active');
  if v_status not in ('active','trialing') then
    raise exception 'AIVANTA_SUBSCRIPTION_INACTIVE' using errcode='P0001';
  end if;

  v_limit := case v_plan
    when 'starter' then 10
    when 'pro' then 50
    when 'business' then 200
    when 'enterprise' then v_custom_workflows
    else 2
  end;
  if v_limit is null then
    raise exception 'AIVANTA_ENTERPRISE_LIMITS_NOT_CONFIGURED' using errcode='P0001';
  end if;

  select count(*) into v_active
    from public.workflows
    where workspace_id=new.workspace_id
      and status='active'
      and id<>new.id;

  if v_active >= v_limit then
    raise exception 'AIVANTA_WORKFLOW_LIMIT_REACHED'
      using errcode='P0001',
      detail=jsonb_build_object('plan',v_plan,'used',v_active,'limit',v_limit)::text;
  end if;
  return new;
end
$$;

revoke all on function private.enforce_active_workflow_entitlement() from public,anon,authenticated;
drop trigger if exists workflows_enforce_active_entitlement on public.workflows;
create trigger workflows_enforce_active_entitlement
  before insert or update of status,workspace_id on public.workflows
  for each row execute function private.enforce_active_workflow_entitlement();


create or replace function public.get_workspace_entitlements(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_plan text := 'free';
  v_status text := 'active';
  v_start date := date_trunc('month',now())::date;
  v_workflows bigint := 0;
  v_runs bigint := 0;
  v_ai bigint := 0;
  v_workflow_limit integer := 2;
  v_execution_limit integer := 300;
  v_ai_limit integer := 25;
begin
  if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode='42501';
  end if;

  select plan_key,status,current_period_start::date,custom_workflow_limit,custom_execution_limit,custom_ai_credit_limit
    into v_plan,v_status,v_start,v_workflow_limit,v_execution_limit,v_ai_limit
    from public.workspace_subscriptions where workspace_id=p_workspace_id;
  v_plan := coalesce(v_plan,'free');
  v_status := coalesce(v_status,'active');
  v_start := coalesce(v_start,date_trunc('month',now())::date);

  if v_plan <> 'enterprise' then
    v_workflow_limit := case v_plan when 'starter' then 10 when 'pro' then 50 when 'business' then 200 else 2 end;
    v_execution_limit := case v_plan when 'starter' then 2000 when 'pro' then 10000 when 'business' then 50000 else 300 end;
    v_ai_limit := case v_plan when 'starter' then 500 when 'pro' then 2500 when 'business' then 15000 else 25 end;
  end if;

  select count(*) into v_workflows from public.workflows
    where workspace_id=p_workspace_id and status='active';
  select coalesce(sum(quantity),0) into v_runs from public.workspace_usage
    where workspace_id=p_workspace_id and period_start=date_trunc('month',now())::date and metric='workflow_execution';
  select coalesce(sum(quantity),0) into v_ai from public.workspace_usage
    where workspace_id=p_workspace_id and period_start=date_trunc('month',now())::date and metric='ai_credit';

  return jsonb_build_object(
    'plan',v_plan,
    'status',v_status,
    'period_start',v_start,
    'usage',jsonb_build_object('workflow_created',v_workflows,'workflow_execution',v_runs,'ai_credit',v_ai),
    'limits',jsonb_build_object('workflow_created',v_workflow_limit,'workflow_execution',v_execution_limit,'ai_credit',v_ai_limit),
    'billing',jsonb_build_object(
      'provider_connected',exists(select 1 from public.workspace_subscriptions where workspace_id=p_workspace_id and billing_provider is not null),
      'checkout_enabled',false
    )
  );
end
$$;
revoke all on function public.get_workspace_entitlements(uuid) from public,anon;
grant execute on function public.get_workspace_entitlements(uuid) to authenticated;
