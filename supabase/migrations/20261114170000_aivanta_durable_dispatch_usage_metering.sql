-- Meter durable scheduler, webhook and manual dispatches in the same transaction as queue creation.
create or replace function public.dispatch_workflow_execution(
 p_workspace_id uuid,p_workflow_id uuid,p_workflow_version integer,p_created_by uuid,
 p_idempotency_key text,p_payload jsonb,p_max_attempts integer,p_execution_mode text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 existing_job public.execution_jobs%rowtype;
 workflow_row public.workflows%rowtype;
 subscription_row public.workspace_subscriptions%rowtype;
 new_run_id uuid;new_job_id uuid;effective_attempts integer;
 v_plan text:='free';v_limit integer:=300;v_used bigint:=0;v_period date:=date_trunc('month',now())::date;
begin
 if p_workspace_id is null or p_workflow_id is null or p_workflow_version is null or p_created_by is null
  or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200
  or p_max_attempts is null or p_max_attempts not between 1 and 20
  or p_execution_mode is null or p_execution_mode not in ('dry_run','live')
  or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16384 then
  raise exception using errcode='22023',message='Invalid execution dispatch request';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_idempotency_key,0));
 select * into existing_job from public.execution_jobs where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
 if found then
  if existing_job.workflow_id<>p_workflow_id or existing_job.execution_mode<>p_execution_mode then
   raise exception using errcode='23505',message='Idempotency key already used for a different workflow or execution mode';
  end if;
  return jsonb_build_object('job_id',existing_job.id,'run_id',existing_job.run_id,'duplicate',true);
 end if;
 if not exists(select 1 from public.workspaces w where w.id=p_workspace_id and (w.owner_id=p_created_by or exists(select 1 from public.workspace_members m where m.workspace_id=w.id and m.user_id=p_created_by))) then
  raise exception using errcode='42501',message='Execution actor is not a workspace member';
 end if;
 select w.* into workflow_row from public.workflows w
 where w.id=p_workflow_id and w.workspace_id=p_workspace_id and w.version=p_workflow_version and w.status='active'
 for share;
 if not found then raise exception using errcode='22023',message='Workflow is not active or version changed';end if;

 -- Share the workspace-wide quota lock used by interactive usage reservations.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text,0));
 select * into subscription_row from public.workspace_subscriptions where workspace_id=p_workspace_id for update;
 if found then
  v_plan:=case when subscription_row.pending_plan_key is not null and subscription_row.pending_plan_effective_at<=now() then subscription_row.pending_plan_key else subscription_row.plan_key end;
  if subscription_row.status not in ('active','trialing') or subscription_row.current_period_end<=now() then
   raise exception using errcode='P0001',message='AIVANTA_SUBSCRIPTION_INACTIVE';
  end if;
  v_limit:=case v_plan when 'starter' then 2000 when 'pro' then 10000 when 'business' then 50000 when 'enterprise' then subscription_row.custom_execution_limit else 300 end;
 else v_plan:='free';v_limit:=300;end if;
 if v_limit is null then raise exception using errcode='P0001',message='AIVANTA_ENTERPRISE_LIMIT_NOT_CONFIGURED';end if;
 select coalesce(sum(u.quantity),0) into v_used from public.workspace_usage u
 where u.workspace_id=p_workspace_id and u.period_start=v_period and u.metric='workflow_execution';
 if v_used+1>v_limit then raise exception using errcode='P0001',message='AIVANTA_WORKFLOW_EXECUTION_LIMIT_REACHED';end if;
 insert into public.workspace_usage(workspace_id,metric,quantity,period_start,actor_user_id,metadata)
 values(p_workspace_id,'workflow_execution',1,v_period,p_created_by,
  jsonb_build_object('source','durable_dispatch','workflow_id',p_workflow_id,'mode',p_execution_mode,'idempotency_key',p_idempotency_key));

 effective_attempts:=case when p_execution_mode='live' then 1 else p_max_attempts end;
 insert into public.workflow_runs(workspace_id,workflow_id,workflow_version,mode,status,created_by,idempotency_key,started_at,completed_at,duration_ms)
 values(p_workspace_id,p_workflow_id,p_workflow_version,p_execution_mode,'running',p_created_by,p_idempotency_key,now(),null,0)
 returning id into new_run_id;
 insert into public.execution_jobs(workspace_id,workflow_id,run_id,workflow_version,workflow_definition,execution_mode,idempotency_key,payload,max_attempts)
 values(p_workspace_id,p_workflow_id,new_run_id,workflow_row.version,workflow_row.definition,p_execution_mode,p_idempotency_key,p_payload,effective_attempts)
 returning id into new_job_id;
 return jsonb_build_object('job_id',new_job_id,'run_id',new_run_id,'duplicate',false,'usage',jsonb_build_object('metric','workflow_execution','used',v_used+1,'limit',v_limit,'plan',v_plan));
end;
$$;
revoke all on function public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer,text) to service_role;

create or replace function public.dispatch_workflow_execution(
 p_workspace_id uuid,p_workflow_id uuid,p_workflow_version integer,p_created_by uuid,
 p_idempotency_key text,p_payload jsonb default '{}'::jsonb,p_max_attempts integer default 5
) returns jsonb language sql security definer set search_path='' as $$
 select public.dispatch_workflow_execution(p_workspace_id,p_workflow_id,p_workflow_version,p_created_by,
  p_idempotency_key,p_payload,p_max_attempts,'dry_run');
$$;
revoke all on function public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer) to service_role;

create or replace function public.reserve_workspace_execution_service(
 p_workspace_id uuid,p_actor_id uuid,p_idempotency_key text,p_source text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare subscription_row public.workspace_subscriptions%rowtype;v_plan text:='free';v_limit integer:=300;v_used bigint:=0;v_period date:=date_trunc('month',now())::date;
begin
 if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
 if p_workspace_id is null or p_actor_id is null or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200
  or p_source not in ('webhook','scheduler','system') then raise exception 'invalid service execution reservation' using errcode='22023';end if;
 if not exists(select 1 from public.workspaces w where w.id=p_workspace_id and (w.owner_id=p_actor_id or exists(select 1 from public.workspace_members m where m.workspace_id=w.id and m.user_id=p_actor_id))) then
  raise exception 'execution actor is not a workspace member' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text,0));
 if exists(select 1 from public.workspace_usage u where u.workspace_id=p_workspace_id and u.metric='workflow_execution' and u.metadata->>'idempotency_key'=p_idempotency_key) then
  return jsonb_build_object('allowed',true,'duplicate',true);
 end if;
 select * into subscription_row from public.workspace_subscriptions where workspace_id=p_workspace_id for update;
 if found then
  v_plan:=case when subscription_row.pending_plan_key is not null and subscription_row.pending_plan_effective_at<=now() then subscription_row.pending_plan_key else subscription_row.plan_key end;
  if subscription_row.status not in ('active','trialing') or subscription_row.current_period_end<=now() then return jsonb_build_object('allowed',false,'reason','subscription_inactive','plan',v_plan);end if;
  v_limit:=case v_plan when 'starter' then 2000 when 'pro' then 10000 when 'business' then 50000 when 'enterprise' then subscription_row.custom_execution_limit else 300 end;
 end if;
 if v_limit is null then return jsonb_build_object('allowed',false,'reason','enterprise_limits_not_configured','plan',v_plan);end if;
 select coalesce(sum(u.quantity),0) into v_used from public.workspace_usage u where u.workspace_id=p_workspace_id and u.period_start=v_period and u.metric='workflow_execution';
 if v_used+1>v_limit then return jsonb_build_object('allowed',false,'reason','limit_reached','used',v_used,'limit',v_limit,'plan',v_plan);end if;
 insert into public.workspace_usage(workspace_id,metric,quantity,period_start,actor_user_id,metadata)
 values(p_workspace_id,'workflow_execution',1,v_period,p_actor_id,jsonb_build_object('source',p_source,'idempotency_key',p_idempotency_key));
 return jsonb_build_object('allowed',true,'duplicate',false,'used',v_used+1,'limit',v_limit,'plan',v_plan);
end $$;
revoke all on function public.reserve_workspace_execution_service(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_workspace_execution_service(uuid,uuid,text,text) to service_role;
