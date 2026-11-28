-- Add the correction-capable Decision Inbox RPC without rewriting migration history.
-- The original staging ledger contains the three-argument RPC; this additive migration
-- installs the four-argument form used by the current API to persist approved corrections.

create or replace function public.resolve_real_estate_playbook_decision(
  p_decision_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_corrections jsonb default '{}'::jsonb
)
returns table (
  result_status text,
  decision_type text,
  lead_id uuid,
  workflow_id uuid,
  workflow_version integer,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision_row public.real_estate_playbook_decisions%rowtype;
  lead_row public.real_estate_leads%rowtype;
  workflow_row public.workflows%rowtype;
  next_status text;
  correction_key text;
begin
  if p_decision not in ('approved','rejected') or p_actor_user_id is null then
    raise exception using errcode='22023', message='Invalid Playbook decision';
  end if;
  if p_corrections is null or pg_catalog.jsonb_typeof(p_corrections) <> 'object' then
    raise exception using errcode='22023', message='Corrections must be an object';
  end if;
  for correction_key in select pg_catalog.jsonb_object_keys(p_corrections) loop
    if correction_key not in ('transaction_type','property_type','preferred_location','budget_min','budget_max','timeframe','readiness','main_concern') then
      raise exception using errcode='22023', message='Unsupported lead correction field';
    end if;
  end loop;

  select * into decision_row
    from public.real_estate_playbook_decisions
   where id = p_decision_id
   for update;
  if not found then
    return query select 'not_found'::text, null::text, null::uuid, null::uuid, null::integer, null::uuid;
    return;
  end if;

  if p_corrections <> '{}'::jsonb and (p_decision <> 'approved' or decision_row.decision_type <> 'qualification_review') then
    raise exception using errcode='22023', message='Only approved qualification reviews can include corrections';
  end if;

  if decision_row.status <> 'pending' then
    return query select decision_row.status, decision_row.decision_type, decision_row.lead_id,
      decision_row.workflow_id, decision_row.workflow_version, decision_row.workspace_id;
    return;
  end if;

  if decision_row.expires_at <= now() then
    update public.real_estate_playbook_decisions
       set status='expired', decided_at=now()
     where id=decision_row.id;
    update public.real_estate_leads
       set pipeline_status='blocked',
           pipeline_next_attempt_at=now() + interval '10 years',
           pipeline_last_error_code='PLAYBOOK_DECISION_EXPIRED'
     where id=decision_row.lead_id and workspace_id=decision_row.workspace_id;
    return query select 'expired'::text, decision_row.decision_type, decision_row.lead_id,
      decision_row.workflow_id, decision_row.workflow_version, decision_row.workspace_id;
    return;
  end if;

  select * into lead_row
    from public.real_estate_leads
   where id=decision_row.lead_id and workspace_id=decision_row.workspace_id
   for update;
  if not found or lead_row.workflow_id is distinct from decision_row.workflow_id
      or lead_row.playbook_version is distinct from decision_row.workflow_version then
    update public.real_estate_playbook_decisions
       set status='invalidated', decided_at=now()
     where id=decision_row.id;
    return query select 'invalidated'::text, decision_row.decision_type, decision_row.lead_id,
      decision_row.workflow_id, decision_row.workflow_version, decision_row.workspace_id;
    return;
  end if;

  select * into workflow_row
    from public.workflows
   where id=decision_row.workflow_id and workspace_id=decision_row.workspace_id;
  if not found or workflow_row.status <> 'active' or workflow_row.version <> decision_row.workflow_version then
    update public.real_estate_playbook_decisions
       set status='invalidated', decided_at=now()
     where id=decision_row.id;
    return query select 'invalidated'::text, decision_row.decision_type, decision_row.lead_id,
      decision_row.workflow_id, decision_row.workflow_version, decision_row.workspace_id;
    return;
  end if;

  if p_corrections ? 'transaction_type' and (pg_catalog.jsonb_typeof(p_corrections->'transaction_type') <> 'string' or p_corrections->>'transaction_type' not in ('buy','rent','invest','sell','unknown')) then
    raise exception using errcode='22023', message='Invalid transaction type correction';
  end if;
  if p_corrections ? 'property_type' and (pg_catalog.jsonb_typeof(p_corrections->'property_type') <> 'string' or p_corrections->>'property_type' not in ('apartment','house','land','commercial','other','unknown')) then
    raise exception using errcode='22023', message='Invalid property type correction';
  end if;
  if p_corrections ? 'timeframe' and (pg_catalog.jsonb_typeof(p_corrections->'timeframe') <> 'string' or p_corrections->>'timeframe' not in ('urgent','within_30_days','one_to_three_months','over_three_months','unknown')) then
    raise exception using errcode='22023', message='Invalid timeframe correction';
  end if;
  if p_corrections ? 'readiness' and (pg_catalog.jsonb_typeof(p_corrections->'readiness') <> 'string' or p_corrections->>'readiness' not in ('cash_ready','pre_approved','financing_needed','researching','unknown')) then
    raise exception using errcode='22023', message='Invalid readiness correction';
  end if;
  if p_corrections ? 'preferred_location' and (pg_catalog.jsonb_typeof(p_corrections->'preferred_location') <> 'string' or length(trim(p_corrections->>'preferred_location')) not between 1 and 200) then
    raise exception using errcode='22023', message='Invalid location correction';
  end if;
  if p_corrections ? 'main_concern' and (pg_catalog.jsonb_typeof(p_corrections->'main_concern') <> 'string' or length(trim(p_corrections->>'main_concern')) > 500) then
    raise exception using errcode='22023', message='Invalid main concern correction';
  end if;
  if p_corrections ? 'budget_min' and (pg_catalog.jsonb_typeof(p_corrections->'budget_min') <> 'number' or (p_corrections->>'budget_min')::numeric < 0 or (p_corrections->>'budget_min')::numeric > 999999999999.99) then
    raise exception using errcode='22023', message='Invalid minimum budget correction';
  end if;
  if p_corrections ? 'budget_max' and (pg_catalog.jsonb_typeof(p_corrections->'budget_max') <> 'number' or (p_corrections->>'budget_max')::numeric < 0 or (p_corrections->>'budget_max')::numeric > 999999999999.99) then
    raise exception using errcode='22023', message='Invalid maximum budget correction';
  end if;
  if coalesce((p_corrections->>'budget_min')::numeric, lead_row.budget_min) is not null
     and coalesce((p_corrections->>'budget_max')::numeric, lead_row.budget_max) is not null
     and coalesce((p_corrections->>'budget_max')::numeric, lead_row.budget_max) < coalesce((p_corrections->>'budget_min')::numeric, lead_row.budget_min) then
    raise exception using errcode='22023', message='Maximum budget cannot be lower than minimum budget';
  end if;

  next_status := p_decision;
  update public.real_estate_playbook_decisions
     set status=next_status, decided_by=p_actor_user_id, decided_at=now()
   where id=decision_row.id;

  if p_decision = 'approved' then
    update public.real_estate_leads
       set transaction_type=case when p_corrections ? 'transaction_type' then p_corrections->>'transaction_type' else transaction_type end,
           property_type=case when p_corrections ? 'property_type' then p_corrections->>'property_type' else property_type end,
           preferred_location=case when p_corrections ? 'preferred_location' then p_corrections->>'preferred_location' else preferred_location end,
           budget_min=case when p_corrections ? 'budget_min' then (p_corrections->>'budget_min')::numeric else budget_min end,
           budget_max=case when p_corrections ? 'budget_max' then (p_corrections->>'budget_max')::numeric else budget_max end,
           timeframe=case when p_corrections ? 'timeframe' then p_corrections->>'timeframe' else timeframe end,
           readiness=case when p_corrections ? 'readiness' then p_corrections->>'readiness' else readiness end,
           main_concern=case when p_corrections ? 'main_concern' then p_corrections->>'main_concern' else main_concern end,
           qualification=case when p_corrections <> '{}'::jsonb then qualification || pg_catalog.jsonb_build_object('manualCorrections',p_corrections) else qualification end,
           pipeline_status='pending',
           pipeline_next_attempt_at=now(),
           pipeline_last_error_code=null,
           qualification_status=case
             when decision_row.node_id='gemini' and decision_row.decision_type in ('action_approval','provider_failure') then 'pending'
             else qualification_status end,
           qualification_error_code=null,
           agent_notification_status=case
             when decision_row.node_id='email' and decision_row.decision_type in ('action_approval','provider_failure') then 'pending'
             else agent_notification_status end,
           agent_notification_error_code=null
     where id=decision_row.lead_id and workspace_id=decision_row.workspace_id;
  else
    update public.real_estate_leads
       set pipeline_status='blocked',
           pipeline_next_attempt_at=now() + interval '10 years',
           pipeline_last_error_code='PLAYBOOK_DECISION_REJECTED'
     where id=decision_row.lead_id and workspace_id=decision_row.workspace_id;
  end if;

  insert into public.real_estate_lead_activities(
    workspace_id, lead_id, actor_user_id, activity_type, details
  ) values (
    decision_row.workspace_id,
    decision_row.lead_id,
    p_actor_user_id,
    case when p_decision='approved' then 'lead.playbook_decision_approved' else 'lead.playbook_decision_rejected' end,
    pg_catalog.jsonb_build_object(
      'decisionId', decision_row.id,
      'decisionType', decision_row.decision_type,
      'workflowVersion', decision_row.workflow_version,
      'stepId', decision_row.step_id,
      'nodeId', decision_row.node_id,
      'operationId', decision_row.operation_id,
      'corrections', case when p_decision='approved' then p_corrections else '{}'::jsonb end
    )
  );

  return query select next_status, decision_row.decision_type, decision_row.lead_id,
    decision_row.workflow_id, decision_row.workflow_version, decision_row.workspace_id;
end;
$$;

revoke all on function public.resolve_real_estate_playbook_decision(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.resolve_real_estate_playbook_decision(uuid,uuid,text,jsonb) to service_role;
