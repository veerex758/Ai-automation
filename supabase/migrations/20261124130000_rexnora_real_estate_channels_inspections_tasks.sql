-- Real-estate customer messaging, inspection bookings and back-office task ledger.
-- Additive: no existing production data is rewritten. Client roles may read only
-- their own workspace records; all operational writes use service_role functions.

create table if not exists public.real_estate_channel_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.real_estate_leads(id) on delete cascade,
  channel text not null check (channel in ('whatsapp')),
  sequence smallint not null default 1 check (sequence > 0 and sequence <= 20),
  status text not null default 'sending'
    check (status in ('sending','accepted','unknown','failed','blocked','cancelled')),
  idempotency_key varchar(240) not null,
  provider_message_id varchar(300),
  last_error_code varchar(80),
  request_started_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_channel_deliveries_idempotency_unique unique (workspace_id,idempotency_key),
  constraint real_estate_channel_deliveries_lead_channel_unique unique (workspace_id,lead_id,channel,sequence)
);

create index if not exists real_estate_channel_deliveries_workspace_status_idx
  on public.real_estate_channel_deliveries(workspace_id,status,created_at desc);
create index if not exists real_estate_channel_deliveries_lead_idx
  on public.real_estate_channel_deliveries(lead_id,created_at desc);

alter table public.real_estate_channel_deliveries enable row level security;
create policy real_estate_channel_deliveries_member_read
  on public.real_estate_channel_deliveries for select to authenticated
  using (private.is_workspace_member(workspace_id));
revoke all on public.real_estate_channel_deliveries from anon,authenticated;
grant select on public.real_estate_channel_deliveries to authenticated;
grant all on public.real_estate_channel_deliveries to service_role;

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
  status text not null default 'requested'
    check (status in ('requested','creating','confirmed','unknown','failed','rejected','cancelled')),
  idempotency_key varchar(240) not null,
  google_event_id varchar(300),
  google_event_url text,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  last_error_code varchar(80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_inspection_booking_interval check (end_at > start_at),
  constraint real_estate_inspection_booking_duration check (end_at <= start_at + interval '3 hours'),
  constraint real_estate_inspection_booking_idempotency_unique unique (workspace_id,idempotency_key)
);

create index if not exists real_estate_inspection_bookings_google_connection_idx
  on public.real_estate_inspection_bookings(workspace_id,google_connection_id,status);
create index if not exists real_estate_inspection_bookings_workspace_time_idx
  on public.real_estate_inspection_bookings(workspace_id,google_connection_id,calendar_id,start_at,end_at)
  where status in ('requested','creating','confirmed','unknown');
create index if not exists real_estate_inspection_bookings_lead_idx
  on public.real_estate_inspection_bookings(workspace_id,lead_id,created_at desc);

alter table public.real_estate_inspection_bookings enable row level security;
create policy real_estate_inspection_bookings_member_read
  on public.real_estate_inspection_bookings for select to authenticated
  using (private.is_workspace_member(workspace_id));
revoke all on public.real_estate_inspection_bookings from anon,authenticated;
grant select on public.real_estate_inspection_bookings to authenticated;
grant all on public.real_estate_inspection_bookings to service_role;

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

create index if not exists real_estate_tasks_queue_idx
  on public.real_estate_tasks(workspace_id,status,due_at asc);
create index if not exists real_estate_tasks_assignee_idx
  on public.real_estate_tasks(workspace_id,assigned_agent_id,status,due_at asc);
create index if not exists real_estate_tasks_lead_idx
  on public.real_estate_tasks(workspace_id,lead_id,created_at desc);

alter table public.real_estate_tasks enable row level security;
create policy real_estate_tasks_member_read
  on public.real_estate_tasks for select to authenticated
  using (private.is_workspace_member(workspace_id));
revoke all on public.real_estate_tasks from anon,authenticated;
grant select on public.real_estate_tasks to authenticated;
grant all on public.real_estate_tasks to service_role;

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
  p_idempotency_key text,
  p_requested_by uuid
)
returns table(booking_id uuid, booking_status text, slot_conflict boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior public.real_estate_inspection_bookings%rowtype;
  inserted public.real_estate_inspection_bookings%rowtype;
begin
  if p_workspace_id is null or p_lead_id is null or p_google_connection_id is null or p_requested_by is null
     or p_calendar_id is null or length(p_calendar_id) < 1 or length(p_calendar_id) > 300
     or p_time_zone is null or length(p_time_zone) < 1 or length(p_time_zone) > 100
     or p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 240
     or p_start_at <= now() or p_end_at < p_start_at + interval '5 minutes'
     or p_end_at > p_start_at + interval '3 hours'
     or p_start_at > now() + interval '180 days' then
    raise exception using errcode='22023', message='Invalid inspection booking request';
  end if;

  if not exists(select 1 from public.real_estate_leads l where l.id=p_lead_id and l.workspace_id=p_workspace_id) then
    raise exception using errcode='P0002', message='Lead not found in workspace';
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
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_google_connection_id::text || ':' || p_calendar_id, 0)
  );

  select * into prior from public.real_estate_inspection_bookings
   where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
  if found then
    if prior.lead_id is distinct from p_lead_id or prior.property_id is distinct from p_property_id
       or prior.agent_id is distinct from p_agent_id or prior.google_connection_id is distinct from p_google_connection_id
       or prior.calendar_id is distinct from p_calendar_id or prior.time_zone is distinct from p_time_zone
       or prior.start_at is distinct from p_start_at or prior.end_at is distinct from p_end_at then
      raise exception using errcode='23505', message='Inspection idempotency key reused with different booking data';
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
    status,idempotency_key,requested_by
  ) values (
    p_workspace_id,p_lead_id,p_property_id,p_agent_id,p_google_connection_id,p_calendar_id,p_start_at,p_end_at,p_time_zone,
    'requested',p_idempotency_key,p_requested_by
  ) returning * into inserted;

  return query select inserted.id,inserted.status,false;
end;
$$;

revoke all on function public.reserve_real_estate_inspection_booking(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_real_estate_inspection_booking(uuid,uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid) to service_role;

create or replace function public.begin_real_estate_inspection_booking(
  p_workspace_id uuid,
  p_booking_id uuid,
  p_approved_by uuid
)
returns table(result_status text, booking_id uuid)
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
  if booking_row.status <> 'requested' then
    return query select booking_row.status,booking_row.id;
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(booking_row.workspace_id::text || ':' || booking_row.google_connection_id::text || ':' || booking_row.calendar_id, 0)
  );
  if exists(
    select 1 from public.real_estate_inspection_bookings b
     where b.workspace_id=booking_row.workspace_id and b.google_connection_id=booking_row.google_connection_id and b.calendar_id=booking_row.calendar_id
       and b.id<>booking_row.id
       and b.status in ('requested','creating','confirmed','unknown')
       and b.start_at < booking_row.end_at and b.end_at > booking_row.start_at
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

revoke all on function public.begin_real_estate_inspection_booking(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_real_estate_inspection_booking(uuid,uuid,uuid) to service_role;
