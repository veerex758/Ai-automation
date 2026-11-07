-- Phase 5 hardening: serialize usage reservations and enforce active workflow caps at write time.
-- This migration is additive and safe to replay on a clean database.

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

  select plan_key,status into v_plan,v_status
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
begin
  if new.status <> 'active' then
    return new;
  end if;

  -- Hold the workspace lock through the workflow INSERT/UPDATE transaction.
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,0));

  select plan_key,status into v_plan,v_status
    from public.workspace_subscriptions where workspace_id=new.workspace_id;
  if v_status not in ('active','trialing') then
    raise exception 'AIVANTA_SUBSCRIPTION_INACTIVE' using errcode='P0001';
  end if;

  v_limit := case v_plan
    when 'starter' then 10
    when 'pro' then 50
    when 'business' then 200
    else 2
  end;

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
