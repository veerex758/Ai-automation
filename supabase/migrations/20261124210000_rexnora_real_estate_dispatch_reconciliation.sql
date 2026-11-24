
-- Rexnora real-estate staging reconciliation.
-- Forward-only: never rewrite or stamp prior migration versions.
-- Recreates the real-estate task, booking and channel-delivery objects in fresh
-- installs, and extends existing channel deliveries with conservative retries.

create table if not exists public.real_estate_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.real_estate_leads(id) on delete cascade,
  assigned_agent_id uuid references public.agents(id) on delete set null,
  task_type text not null check (task_type in ('new_enquiry_review','customer_follow_up','inspection_preparation','crm_review')),
  title varchar(200) not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','completed','cancelled')),
  priority text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  due_at timestamptz not null,
  idempotency_key varchar(240) not null,
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_tasks_idempotency_unique unique (workspace_id,idempotency_key)
);

create table if not exists public.real_estate_inspection_bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.real_estate_leads(id) on delete cascade,
  property_id uuid references public.real_estate_properties(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  google_connection_id uuid not null references public.google_connections(id) on delete restrict,
  calendar_id varchar(300) not null default 'primary',
  start_at timestamptz not null,
  end_at timestamptz not null,
  time_zone varchar(100) not null,
  customer_invite_requested boolean not null default false,
  customer_invite_email text,
  status text not null default 'requested' check (status in ('requested','creating','confirmed','unknown','failed','rejected','cancelled')),
  idempotency_key varchar(240) not null,
  google_event_id varchar(300),
  google_event_url text,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  last_error_code varchar(100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_inspection_booking_interval check (end_at > start_at),
  constraint real_estate_inspection_booking_duration check (end_at <= start_at + interval '3 hours'),
  constraint real_estate_inspection_booking_invite_valid check (
    (customer_invite_requested = false and customer_invite_email is null)
    or (customer_invite_requested = true and customer_invite_email is not null)
  ),
  constraint real_estate_inspection_booking_idempotency_unique unique (workspace_id,idempotency_key)
);

create table if not exists public.real_estate_channel_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.real_estate_leads(id) on delete cascade,
  channel text not null check (channel = 'whatsapp'),
  sequence smallint not null default 1 check (sequence > 0 and sequence <= 20),
  status text not null default 'pending' check (status in ('pending','sending','accepted','unknown','failed','blocked','cancelled')),
  idempotency_key varchar(240) not null,
  recipient_phone text,
  template_name varchar(512),
  template_language varchar(12),
  template_parameters jsonb not null default '[]'::jsonb,
  consent_snapshot jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  provider_message_id varchar(300),
  last_error_code varchar(100),
  request_started_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_channel_deliveries_idempotency_unique unique (workspace_id,idempotency_key),
  constraint real_estate_channel_deliveries_lead_channel_unique unique (workspace_id,lead_id,channel,sequence),
  constraint real_estate_channel_deliveries_status_check check (status in ('pending','sending','accepted','unknown','failed','blocked','cancelled'))
);

alter table public.real_estate_channel_deliveries
  add column if not exists recipient_phone text,
  add column if not exists template_name varchar(512),
  add column if not exists template_language varchar(12),
  add column if not exists template_parameters jsonb not null default '[]'::jsonb,
  add column if not exists consent_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists lease_token uuid,
  add column if not exists lease_until timestamptz,
  add column if not exists last_attempt_at timestamptz;

alter table public.real_estate_channel_deliveries
  alter column status set default 'pending';

alter table public.real_estate_channel_deliveries
  drop constraint if exists real_estate_channel_deliveries_status_check;

alter table public.real_estate_channel_deliveries
  add constraint real_estate_channel_deliveries_status_check
  check (status in ('pending','sending','accepted','unknown','failed','blocked','cancelled'));

create index if not exists real_estate_tasks_due_idx
  on public.real_estate_tasks(workspace_id,status,due_at);
create index if not exists real_estate_inspection_bookings_calendar_idx
  on public.real_estate_inspection_bookings(workspace_id,google_connection_id,calendar_id,start_at,end_at)
  where status in ('requested','creating','confirmed','unknown');
create index if not exists real_estate_channel_deliveries_due_idx
  on public.real_estate_channel_deliveries(next_attempt_at,created_at)
  where status='pending';
create index if not exists real_estate_channel_deliveries_expired_lease_idx
  on public.real_estate_channel_deliveries(lease_until)
  where status='sending';

alter table public.real_estate_tasks enable row level security;
alter table public.real_estate_inspection_bookings enable row level security;
alter table public.real_estate_channel_deliveries enable row level security;

create or replace function public.claim_due_real_estate_channel_deliveries(
  p_limit integer default 25,
  p_lease_seconds integer default 90
)
returns setof public.real_estate_channel_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100
     or p_lease_seconds is null or p_lease_seconds not between 15 and 600 then
    raise exception using errcode='22023', message='Invalid channel delivery claim limits';
  end if;

  return query
  with candidates as (
    select d.id
      from public.real_estate_channel_deliveries d
     where d.status='pending'
       and d.next_attempt_at <= now()
       and d.attempt_count < d.max_attempts
       and (d.lease_until is null or d.lease_until <= now())
     order by d.next_attempt_at,d.created_at
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.real_estate_channel_deliveries d
       set status='sending',
           attempt_count=d.attempt_count+1,
           lease_token=gen_random_uuid(),
           lease_until=now() + make_interval(secs => p_lease_seconds),
           last_attempt_at=now(),
           request_started_at=now(),
           updated_at=now()
      from candidates c
     where d.id=c.id
     returning d.*
  )
  select * from claimed;
end;
$$;

create or replace function public.finish_real_estate_channel_delivery(
  p_workspace_id uuid,
  p_delivery_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_retry_after_seconds integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_count integer;
begin
  if p_workspace_id is null or p_delivery_id is null or p_lease_token is null
     or p_outcome not in ('accepted','failed','unknown','blocked','cancelled')
     or p_retry_after_seconds is null or p_retry_after_seconds not between 0 and 86400 then
    raise exception using errcode='22023', message='Invalid channel delivery result';
  end if;

  update public.real_estate_channel_deliveries d
     set status=case
           when p_outcome='failed' and p_retry_after_seconds > 0 and d.attempt_count < d.max_attempts then 'pending'
           else p_outcome
         end,
         next_attempt_at=case
           when p_outcome='failed' and p_retry_after_seconds > 0 and d.attempt_count < d.max_attempts
             then now() + make_interval(secs => p_retry_after_seconds)
           else d.next_attempt_at
         end,
         provider_message_id=coalesce(p_provider_message_id,d.provider_message_id),
         last_error_code=case when p_outcome='accepted' then null else left(coalesce(p_error_code,p_outcome),100) end,
         accepted_at=case when p_outcome='accepted' then now() else d.accepted_at end,
         lease_token=null,
         lease_until=null,
         updated_at=now()
   where d.id=p_delivery_id
     and d.workspace_id=p_workspace_id
     and d.lease_token=p_lease_token
     and d.status='sending';

  get diagnostics row_count = row_count;
  return row_count=1;
end;
$$;

create or replace function public.reconcile_expired_real_estate_channel_deliveries(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception using errcode='22023',message='Invalid channel reconciliation limit';
  end if;
  with expired as (
    select d.id
      from public.real_estate_channel_deliveries d
     where d.status='sending'
       and (d.lease_until is null or d.lease_until <= now())
     order by d.updated_at
     for update skip locked
     limit p_limit
  ), marked as (
    update public.real_estate_channel_deliveries d
       set status='unknown',
           last_error_code='DELIVERY_OUTCOME_UNKNOWN',
           lease_token=null,
           lease_until=null,
           updated_at=now()
      from expired e
     where d.id=e.id
     returning d.id
  )
  select count(*)::integer into changed from marked;
  return changed;
end;
$$;

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


create or replace function public.reserve_real_estate_inspection_booking(
  p_workspace_id uuid,
  p_lead_id uuid,
  p_property_id uuid,
  p_agent_id uuid,
  p_google_connection_id uuid,
  p_calendar_id text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_time_zone text,
  p_send_customer_invite boolean,
  p_customer_invite_email text,
  p_idempotency_key text,
  p_requested_by uuid
)
returns table(booking_id uuid,booking_status text,slot_conflict boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare prior public.real_estate_inspection_bookings%rowtype;
declare inserted public.real_estate_inspection_bookings%rowtype;
begin
  if p_workspace_id is null or p_lead_id is null or p_google_connection_id is null or p_requested_by is null
     or p_calendar_id is null or length(p_calendar_id) not between 1 and 300
     or p_time_zone is null or length(p_time_zone) not between 1 and 100
     or p_send_customer_invite is null
     or (p_send_customer_invite and p_customer_invite_email is null)
     or (not p_send_customer_invite and p_customer_invite_email is not null)
     or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 240
     or p_start_at <= now() or p_end_at < p_start_at + interval '5 minutes'
     or p_end_at > p_start_at + interval '3 hours'
     or p_start_at > now() + interval '180 days' then
    raise exception using errcode='22023', message='Invalid inspection booking request';
  end if;

  if not exists(select 1 from public.real_estate_leads l where l.id=p_lead_id and l.workspace_id=p_workspace_id) then
    raise exception using errcode='P0002', message='Lead not found in workspace';
  end if;
  if p_send_customer_invite and not exists(
    select 1 from public.real_estate_leads l
     where l.id=p_lead_id and l.workspace_id=p_workspace_id
       and l.consent_to_contact=true and l.contact_preference='email'
       and lower(l.email)=lower(p_customer_invite_email)
  ) then
    raise exception using errcode='42501', message='Customer email invitation requires recorded email contact consent';
  end if;
  if p_property_id is not null and not exists(
    select 1 from public.real_estate_properties p
     where p.id=p_property_id and p.workspace_id=p_workspace_id
       and p.availability_status='available' and p.available=true
  ) then
    raise exception using errcode='P0002', message='Property is unavailable in workspace';
  end if;
  if p_agent_id is not null and not exists(
    select 1 from public.agents a where a.id=p_agent_id and a.workspace_id=p_workspace_id and a.status='active'
  ) then
    raise exception using errcode='P0002', message='Agent is unavailable in workspace';
  end if;
  if not exists(
    select 1 from public.google_connections gc
     where gc.id=p_google_connection_id and gc.workspace_id=p_workspace_id
       and gc.provider='google' and gc.product='calendar'
       and gc.status='connected' and gc.last_test_status='passed'
  ) then
    raise exception using errcode='P0002', message='Google Calendar connection is not verified in workspace';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_google_connection_id::text || ':' || p_calendar_id,0)
  );
  select * into prior from public.real_estate_inspection_bookings
   where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
  if found then
    if prior.lead_id is distinct from p_lead_id or prior.property_id is distinct from p_property_id
       or prior.agent_id is distinct from p_agent_id or prior.google_connection_id is distinct from p_google_connection_id
       or prior.calendar_id is distinct from p_calendar_id or prior.time_zone is distinct from p_time_zone
       or prior.customer_invite_requested is distinct from p_send_customer_invite
       or prior.customer_invite_email is distinct from p_customer_invite_email
       or prior.start_at is distinct from p_start_at or prior.end_at is distinct from p_end_at then
      raise exception using errcode='23505',message='Inspection idempotency key reused with different booking data';
    end if;
    return query select prior.id,prior.status,false;
    return;
  end if;
  if exists(
    select 1 from public.real_estate_inspection_bookings b
     where b.workspace_id=p_workspace_id and b.google_connection_id=p_google_connection_id and b.calendar_id=p_calendar_id
       and b.status in ('requested','creating','confirmed','unknown')
       and b.start_at < p_end_at and b.end_at > p_start_at
  ) then
    return query select null::uuid,'conflict'::text,true;
    return;
  end if;

  insert into public.real_estate_inspection_bookings(
    workspace_id,lead_id,property_id,agent_id,google_connection_id,calendar_id,start_at,end_at,time_zone,
    customer_invite_requested,customer_invite_email,status,idempotency_key,requested_by
  ) values (
    p_workspace_id,p_lead_id,p_property_id,p_agent_id,p_google_connection_id,p_calendar_id,p_start_at,p_end_at,p_time_zone,
    p_send_customer_invite,p_customer_invite_email,'requested',p_idempotency_key,p_requested_by
  ) returning * into inserted;
  return query select inserted.id,inserted.status,false;
end;
$$;

create or replace function public.begin_real_estate_inspection_booking(
  p_workspace_id uuid,p_booking_id uuid,p_approved_by uuid
)
returns table(result_status text,booking_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare booking_row public.real_estate_inspection_bookings%rowtype;
begin
  if p_workspace_id is null or p_booking_id is null or p_approved_by is null then
    raise exception using errcode='22023',message='Invalid booking approval';
  end if;
  select * into booking_row from public.real_estate_inspection_bookings
   where id=p_booking_id and workspace_id=p_workspace_id for update;
  if not found then
    return query select 'not_found'::text,p_booking_id;
    return;
  end if;
  if booking_row.status='creating' and booking_row.updated_at>now()-interval '5 minutes' then
    return query select 'in_progress'::text,booking_row.id;
    return;
  end if;
  if booking_row.status not in ('requested','unknown','creating') then
    return query select booking_row.status,booking_row.id;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(booking_row.workspace_id::text || ':' || booking_row.google_connection_id::text || ':' || booking_row.calendar_id,0)
  );
  if exists(
    select 1 from public.real_estate_inspection_bookings b
     where b.workspace_id=booking_row.workspace_id and b.google_connection_id=booking_row.google_connection_id and b.calendar_id=booking_row.calendar_id
       and b.id<>booking_row.id
       and b.status in ('requested','creating','confirmed','unknown')
       and b.start_at<booking_row.end_at and b.end_at>booking_row.start_at
  ) then
    update public.real_estate_inspection_bookings set status='failed',last_error_code='INSPECTION_SLOT_CONFLICT',
      updated_at=now() where id=booking_row.id;
    return query select 'conflict'::text,booking_row.id;
    return;
  end if;
  update public.real_estate_inspection_bookings
     set status='creating',approved_by=p_approved_by,approved_at=now(),updated_at=now()
   where id=booking_row.id;
  return query select 'creating'::text,booking_row.id;
end;
$$;

revoke all on function public.claim_due_real_estate_channel_deliveries(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_due_real_estate_channel_deliveries(integer,integer) to service_role;
revoke all on function public.finish_real_estate_channel_delivery(uuid,uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.finish_real_estate_channel_delivery(uuid,uuid,uuid,text,text,text,integer) to service_role;
revoke all on function public.reconcile_expired_real_estate_channel_deliveries(integer) from public,anon,authenticated;
grant execute on function public.reconcile_expired_real_estate_channel_deliveries(integer) to service_role;
revoke all on function public.reserve_real_estate_inspection_booking(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,boolean,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_real_estate_inspection_booking(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,boolean,text,text,uuid) to service_role;
revoke all on function public.begin_real_estate_inspection_booking(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_real_estate_inspection_booking(uuid,uuid,uuid) to service_role;
