-- Keep quota enforcement consistent across workflow, AI and agent entry points.
-- Every SECURITY DEFINER body pins search_path and checks the caller's workspace membership.

create or replace function public.consume_workspace_usage(
  p_workspace_id uuid,
  p_metric text,
  p_quantity integer default 1,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan text := 'free';
  v_status text := 'active';
  v_period_end timestamptz;
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

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,0));

  select case when pending_plan_key is not null and pending_plan_effective_at<=now()
              then pending_plan_key else plan_key end,
         status,current_period_end,custom_workflow_limit,custom_execution_limit,custom_ai_credit_limit
    into v_plan,v_status,v_period_end,v_custom_workflows,v_custom_executions,v_custom_ai_credits
    from public.workspace_subscriptions where workspace_id=p_workspace_id for update;

  v_plan := coalesce(v_plan,'free');
  v_status := coalesce(v_status,'active');
  if v_status not in ('active','trialing') or (v_period_end is not null and v_period_end<=now()) then
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

  v_idempotency_key := nullif(v_metadata->>'idempotency_key','');
  if v_idempotency_key is not null and exists (
    select 1 from public.workspace_usage
    where workspace_id=p_workspace_id and metric=p_metric
      and metadata->>'idempotency_key'=v_idempotency_key
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
$function$;

create or replace function public.get_workspace_entitlements(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan text := 'free';
  v_status text := 'active';
  v_start date := date_trunc('month',now())::date;
  v_period_end timestamptz;
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

  select case when pending_plan_key is not null and pending_plan_effective_at<=now()
              then pending_plan_key else plan_key end,
         status,current_period_start::date,current_period_end,
         custom_workflow_limit,custom_execution_limit,custom_ai_credit_limit
    into v_plan,v_status,v_start,v_period_end,v_workflow_limit,v_execution_limit,v_ai_limit
    from public.workspace_subscriptions where workspace_id=p_workspace_id;

  v_plan := coalesce(v_plan,'free');
  v_status := coalesce(v_status,'active');
  v_start := coalesce(v_start,date_trunc('month',now())::date);
  if v_period_end is not null and v_period_end<=now() and v_status in ('active','trialing') then
    v_status := 'expired';
  end if;

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
    'plan',v_plan,'status',v_status,'period_start',v_start,
    'usage',jsonb_build_object('workflow_created',v_workflows,'workflow_execution',v_runs,'ai_credit',v_ai),
    'limits',jsonb_build_object('workflow_created',v_workflow_limit,'workflow_execution',v_execution_limit,'ai_credit',v_ai_limit,'agent_run',v_ai_limit,'ai_generation',v_ai_limit),
    'billing',jsonb_build_object(
      'provider_connected',exists(select 1 from public.workspace_subscriptions where workspace_id=p_workspace_id and billing_provider is not null),
      'checkout_enabled',false
    )
  );
end
$function$;

create or replace function public.consume_agent_run_usage(
  p_workspace_id uuid,
  p_agent_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan text:='free';
  v_status text:='active';
  v_period_end timestamptz;
  v_custom_ai integer;
  v_limit integer;
  v_agents bigint:=0;
  v_credits bigint:=0;
  v_period date:=date_trunc('month',now())::date;
  v_actor uuid:=auth.uid();
begin
  if v_actor is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode='42501';
  end if;
  if p_agent_id is null or p_idempotency_key is null
     or length(p_idempotency_key)<8 or length(p_idempotency_key)>128 then
    raise exception 'invalid agent usage request' using errcode='22023';
  end if;
  if not exists(select 1 from public.agents where id=p_agent_id and workspace_id=p_workspace_id and status='active') then
    raise exception 'active workspace agent not found' using errcode='P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,0));
  if exists(select 1 from public.workspace_usage where workspace_id=p_workspace_id and metric='agent_run' and metadata->>'idempotency_key'=p_idempotency_key) then
    return jsonb_build_object('allowed',true,'duplicate',true);
  end if;

  select case when pending_plan_key is not null and pending_plan_effective_at<=now()
              then pending_plan_key else plan_key end,
         status,current_period_end,custom_ai_credit_limit
    into v_plan,v_status,v_period_end,v_custom_ai
    from public.workspace_subscriptions where workspace_id=p_workspace_id for update;
  v_plan:=coalesce(v_plan,'free');
  v_status:=coalesce(v_status,'active');
  if v_status not in ('active','trialing') or (v_period_end is not null and v_period_end<=now()) then
    return jsonb_build_object('allowed',false,'reason','subscription_inactive');
  end if;

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
end
$function$;

create or replace function public.request_workspace_subscription_cancellation(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_subscription public.workspace_subscriptions%rowtype;
  v_actor uuid := auth.uid();
begin
  if v_actor is null or p_workspace_id is null or not private.is_workspace_admin(p_workspace_id) then
    raise exception 'workspace billing administrator required' using errcode='42501';
  end if;

  select * into v_subscription from public.workspace_subscriptions
    where workspace_id=p_workspace_id for update;
  if not found then return jsonb_build_object('success',false,'reason','subscription_not_found'); end if;
  if v_subscription.plan_key='free' or v_subscription.status='canceled' then
    return jsonb_build_object('success',false,'reason','no_active_paid_subscription');
  end if;
  if v_subscription.cancel_at_period_end then
    return jsonb_build_object('success',true,'already_scheduled',true,'cancel_at_period_end',true,'current_period_end',v_subscription.current_period_end);
  end if;
  if v_subscription.current_period_end<=now() then
    update public.workspace_subscriptions set status='canceled',cancel_at_period_end=false,updated_at=now()
      where id=v_subscription.id;
    return jsonb_build_object('success',true,'canceled',true,'cancel_at_period_end',false);
  end if;
  update public.workspace_subscriptions set cancel_at_period_end=true,updated_at=now() where id=v_subscription.id;
  return jsonb_build_object('success',true,'canceled',false,'cancel_at_period_end',true,'access_until',v_subscription.current_period_end);
end
$function$;
