-- Rexnora Playbook policy decisions and append-only review queue.
-- This migration is additive and must be applied to staging before PR activation.
alter table public.real_estate_leads
  add column if not exists playbook_version integer
    check (playbook_version is null or playbook_version > 0);

create index if not exists real_estate_leads_playbook_binding_idx
  on public.real_estate_leads(workspace_id, workflow_id, playbook_version, created_at desc)
  where workflow_id is not null and playbook_version is not null;

create unique index if not exists workflows_id_workspace_unique_idx
  on public.workflows(id, workspace_id);

create unique index if not exists workflows_one_active_playbook_per_workspace_idx
  on public.workflows(workspace_id)
  where status = 'active' and definition ? 'playbook';

create table if not exists public.real_estate_playbook_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null,
  workflow_version integer not null check (workflow_version > 0),
  lead_id uuid not null,
  decision_type text not null check (decision_type in ('action_approval','qualification_review','provider_failure')),
  step_id varchar(64),
  node_id varchar(80),
  operation_id varchar(120),
  permission text not null check (permission in ('ask_first','review')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','executed','expired','invalidated')),
  reason varchar(500) not null,
  safe_details jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_details) = 'object'),
  idempotency_key varchar(240) not null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint real_estate_playbook_decisions_lead_workspace_fk
    foreign key (lead_id, workspace_id)
    references public.real_estate_leads(id, workspace_id) on delete cascade,
  constraint real_estate_playbook_decisions_workflow_workspace_fk
    foreign key (workflow_id, workspace_id)
    references public.workflows(id, workspace_id) on delete cascade,
  constraint real_estate_playbook_decisions_version_fk
    foreign key (workflow_id, workflow_version)
    references public.workflow_versions(workflow_id, version) on delete cascade,
  constraint real_estate_playbook_decisions_idempotency_unique
    unique (workspace_id, idempotency_key),
  constraint real_estate_playbook_decisions_resolution_pair
    check ((status in ('approved','rejected','executed','expired','invalidated')) = (decided_at is not null OR status in ('executed','expired','invalidated')))
);

create index if not exists real_estate_playbook_decisions_inbox_idx
  on public.real_estate_playbook_decisions(workspace_id, workflow_id, status, requested_at desc);
create index if not exists real_estate_playbook_decisions_lead_idx
  on public.real_estate_playbook_decisions(lead_id, requested_at desc);

alter table public.real_estate_playbook_decisions enable row level security;
create policy real_estate_playbook_decisions_member_read
  on public.real_estate_playbook_decisions for select to authenticated
  using (private.is_workspace_member(workspace_id));

revoke all on public.real_estate_playbook_decisions from anon, authenticated;
grant select on public.real_estate_playbook_decisions to authenticated;
grant all on public.real_estate_playbook_decisions to service_role;

CREATE OR REPLACE FUNCTION public.resolve_real_estate_playbook_decision(p_decision_id uuid, p_actor_user_id uuid, p_decision text)
 RETURNS TABLE(result_status text, decision_type text, lead_id uuid, workflow_id uuid, workflow_version integer, workspace_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  decision_row public.real_estate_playbook_decisions%rowtype;
  lead_row public.real_estate_leads%rowtype;
  workflow_row public.workflows%rowtype;
  next_status text;
begin
  if p_decision not in ('approved','rejected') or p_actor_user_id is null then
    raise exception using errcode='22023', message='Invalid Playbook decision';
  end if;

  select * into decision_row
    from public.real_estate_playbook_decisions
   where id = p_decision_id
   for update;
  if not found then
    return query select 'not_found'::text, null::text, null::uuid, null::uuid, null::integer, null::uuid;
    return;
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

  next_status := p_decision;
  update public.real_estate_playbook_decisions
     set status=next_status, decided_by=p_actor_user_id, decided_at=now()
   where id=decision_row.id;

  if p_decision = 'approved' then
    update public.real_estate_leads
       set pipeline_status='pending',
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
      'operationId', decision_row.operation_id
    )
  );

  return query select next_status, decision_row.decision_type, decision_row.lead_id,
    decision_row.workflow_id, decision_row.workflow_version, decision_row.workspace_id;
end;
$function$
revoke all on function public.resolve_real_estate_playbook_decision(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.resolve_real_estate_playbook_decision(uuid,uuid,text) to service_role;
revoke all on function public.resolve_real_estate_playbook_decision(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.resolve_real_estate_playbook_decision(uuid,uuid,text,jsonb) to service_role;
