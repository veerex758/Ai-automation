-- Real-estate lead management, listing inventory and consent-aware follow-up queue.
-- Workspace-scoped data is protected by RLS; public intake tokens and queue leases
-- are accessible only to trusted server-side service-role code.

create unique index if not exists agents_workspace_id_id_unique_idx on public.agents(workspace_id,id);

create table if not exists public.real_estate_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source varchar(80) not null default 'manual' check (length(trim(source)) between 1 and 80),
  source_event_id varchar(200),
  full_name varchar(160) not null check (length(trim(full_name)) between 1 and 160),
  email varchar(254),
  phone varchar(40),
  transaction_type text not null default 'unknown' check (transaction_type in ('buy','rent','invest','sell','unknown')),
  property_type text not null default 'unknown' check (property_type in ('apartment','house','land','commercial','other','unknown')),
  preferred_location varchar(200),
  budget_min numeric(14,2) check (budget_min is null or budget_min >= 0),
  budget_max numeric(14,2) check (budget_max is null or budget_max >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  bedrooms smallint check (bedrooms is null or bedrooms between 0 and 50),
  timeframe text not null default 'unknown' check (timeframe in ('urgent','within_30_days','one_to_three_months','over_three_months','unknown')),
  readiness text not null default 'unknown' check (readiness in ('cash_ready','pre_approved','financing_needed','researching','unknown')),
  financing_notes varchar(500),
  main_concern varchar(500),
  contact_preference text not null default 'email' check (contact_preference in ('email','phone','whatsapp')),
  consent_to_contact boolean not null default false,
  consent_text varchar(1000),
  consent_at timestamptz,
  qualification jsonb not null default '{}'::jsonb check (jsonb_typeof(qualification) = 'object'),
  qualification_summary text,
  suggested_reply text,
  lead_score smallint not null default 0 check (lead_score between 0 and 100),
  score_factors jsonb not null default '[]'::jsonb check (jsonb_typeof(score_factors) = 'array'),
  lead_temperature text not null default 'cold' check (lead_temperature in ('hot','warm','cold')),
  status text not null default 'new' check (status in ('new','qualified','contacted','viewing_scheduled','negotiation','won','lost')),
  assigned_agent_id uuid,
  customer_responded_at timestamptz,
  agent_takeover_at timestamptz,
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  closed_at timestamptz,
  raw_enquiry jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_enquiry) = 'object'),
  workflow_id uuid references public.workflows(id) on delete set null,
  workflow_run_id uuid references public.workflow_runs(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_lead_budget_order check (budget_min is null or budget_max is null or budget_max >= budget_min),
  constraint real_estate_lead_contact check (email is not null or phone is not null or source <> 'manual'),
  constraint real_estate_leads_source_event_unique unique (workspace_id,source,source_event_id)
);
create unique index if not exists real_estate_leads_id_workspace_unique_idx on public.real_estate_leads(id,workspace_id);
create index if not exists real_estate_leads_workspace_created_idx on public.real_estate_leads(workspace_id,created_at desc);
create index if not exists real_estate_leads_workspace_score_idx on public.real_estate_leads(workspace_id,lead_score desc,created_at desc);
create index if not exists real_estate_leads_workspace_status_idx on public.real_estate_leads(workspace_id,status,updated_at desc);
create index if not exists real_estate_leads_workspace_assignee_idx on public.real_estate_leads(workspace_id,assigned_agent_id) where assigned_agent_id is not null;

create table if not exists public.real_estate_properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reference varchar(100) not null,
  title varchar(200) not null,
  description text not null default '' check (length(description) <= 6000),
  property_type text not null check (property_type in ('apartment','house','land','commercial','other')),
  transaction_type text not null check (transaction_type in ('sale','rent')),
  location varchar(200) not null,
  address varchar(300),
  price numeric(14,2) not null check (price > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  bedrooms smallint check (bedrooms is null or bedrooms between 0 and 50),
  bathrooms numeric(4,1) check (bathrooms is null or bathrooms between 0 and 50),
  area_sqm numeric(10,2) check (area_sqm is null or area_sqm > 0),
  listing_url text,
  availability_status text not null default 'available' check (availability_status in ('available','pending','sold','rented','withdrawn')),
  available boolean not null default true,
  last_verified_at timestamptz,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,reference),
  constraint real_estate_property_availability_consistent check (available = (availability_status = 'available'))
);
create index if not exists real_estate_properties_workspace_active_idx on public.real_estate_properties(workspace_id,availability_status,property_type,price) where available = true;

create table if not exists public.real_estate_lead_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  activity_type varchar(80) not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  constraint real_estate_activity_lead_workspace_fk foreign key (lead_id,workspace_id)
    references public.real_estate_leads(id,workspace_id) on delete cascade
);
create index if not exists real_estate_activities_lead_created_idx on public.real_estate_lead_activities(lead_id,created_at desc);

create table if not exists public.real_estate_followups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null,
  sequence smallint not null check (sequence between 1 and 5),
  channel text not null default 'email' check (channel in ('email')),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','cancelled')),
  subject varchar(200) not null,
  message text not null check (length(message) between 1 and 10000),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 5),
  lease_token uuid,
  lease_until timestamptz,
  provider_message_id varchar(200),
  sent_at timestamptz,
  last_error_code varchar(80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_followup_lead_workspace_fk foreign key (lead_id,workspace_id)
    references public.real_estate_leads(id,workspace_id) on delete cascade,
  constraint real_estate_followup_sequence_unique unique (lead_id,sequence),
  constraint real_estate_followup_lease_pair check ((lease_token is null) = (lease_until is null))
);
create index if not exists real_estate_followups_due_idx on public.real_estate_followups(due_at,created_at) where status in ('pending','sending');

create table if not exists public.real_estate_followup_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  followup_id uuid not null references public.real_estate_followups(id) on delete cascade,
  attempt_number smallint not null,
  status text not null check (status in ('accepted','failed')),
  provider_message_id varchar(200),
  error_code varchar(80),
  created_at timestamptz not null default now(),
  unique (followup_id,attempt_number)
);
create index if not exists real_estate_followup_attempts_workspace_created_idx on public.real_estate_followup_attempts(workspace_id,created_at desc);

create table if not exists public.real_estate_intake_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name varchar(120) not null check (length(trim(name)) between 1 and 120),
  public_key_hash char(64) not null unique check (public_key_hash ~ '^[a-f0-9]{64}$'),
  default_source varchar(80) not null default 'website',
  allowed_origins text[] not null default '{}',
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(allowed_origins) <= 30)
);

drop trigger if exists real_estate_leads_updated_at on public.real_estate_leads;
create trigger real_estate_leads_updated_at before update on public.real_estate_leads for each row execute function public.set_updated_at();
drop trigger if exists real_estate_properties_updated_at on public.real_estate_properties;
create trigger real_estate_properties_updated_at before update on public.real_estate_properties for each row execute function public.set_updated_at();
drop trigger if exists real_estate_followups_updated_at on public.real_estate_followups;
create trigger real_estate_followups_updated_at before update on public.real_estate_followups for each row execute function public.set_updated_at();
drop trigger if exists real_estate_intake_forms_updated_at on public.real_estate_intake_forms;
create trigger real_estate_intake_forms_updated_at before update on public.real_estate_intake_forms for each row execute function public.set_updated_at();

alter table public.real_estate_leads enable row level security;
alter table public.real_estate_properties enable row level security;
alter table public.real_estate_lead_activities enable row level security;
alter table public.real_estate_followups enable row level security;
alter table public.real_estate_followup_attempts enable row level security;
alter table public.real_estate_intake_forms enable row level security;

create policy real_estate_leads_select on public.real_estate_leads for select to authenticated using (private.is_workspace_member(workspace_id));
create policy real_estate_leads_insert on public.real_estate_leads for insert to authenticated with check (private.is_workspace_member(workspace_id) and (created_by is null or created_by = auth.uid()));
create policy real_estate_leads_update on public.real_estate_leads for update to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy real_estate_leads_delete on public.real_estate_leads for delete to authenticated using (private.is_workspace_owner(workspace_id));
create policy real_estate_properties_select on public.real_estate_properties for select to authenticated using (private.is_workspace_member(workspace_id));
create policy real_estate_properties_insert on public.real_estate_properties for insert to authenticated with check (private.is_workspace_member(workspace_id) and (created_by is null or created_by = auth.uid()));
create policy real_estate_properties_update on public.real_estate_properties for update to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy real_estate_properties_delete on public.real_estate_properties for delete to authenticated using (private.is_workspace_owner(workspace_id));
create policy real_estate_activities_select on public.real_estate_lead_activities for select to authenticated using (private.is_workspace_member(workspace_id));
create policy real_estate_activities_insert on public.real_estate_lead_activities for insert to authenticated with check (private.is_workspace_member(workspace_id) and actor_user_id = auth.uid());
create policy real_estate_followups_select on public.real_estate_followups for select to authenticated using (private.is_workspace_member(workspace_id));
create policy real_estate_followup_attempts_select on public.real_estate_followup_attempts for select to authenticated using (private.is_workspace_member(workspace_id));
create policy real_estate_forms_select on public.real_estate_intake_forms for select to authenticated using (private.is_workspace_member(workspace_id));
create policy real_estate_forms_insert on public.real_estate_intake_forms for insert to authenticated with check (private.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy real_estate_forms_update on public.real_estate_intake_forms for update to authenticated using (private.is_workspace_owner(workspace_id)) with check (private.is_workspace_member(workspace_id));

grant select,insert,update,delete on public.real_estate_leads,public.real_estate_properties to authenticated;
grant select,insert on public.real_estate_lead_activities to authenticated;
grant select on public.real_estate_followups,public.real_estate_followup_attempts to authenticated;
grant select,insert,update on public.real_estate_intake_forms to authenticated;
revoke all on public.real_estate_leads,public.real_estate_properties,public.real_estate_lead_activities,public.real_estate_followups,public.real_estate_followup_attempts,public.real_estate_intake_forms from anon,public;
revoke update,delete,truncate,references,trigger on public.real_estate_lead_activities,public.real_estate_followup_attempts from authenticated,anon;

-- Queue claim is atomic and safe across concurrent cron invocations.
create or replace function public.claim_due_real_estate_followups(p_limit integer default 25,p_lease_seconds integer default 180)
returns table(id uuid,workspace_id uuid,lead_id uuid,sequence smallint,channel text,due_at timestamptz,status text,subject text,message text,attempt_count smallint,max_attempts smallint,lease_token uuid)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception using errcode='22023',message='Invalid follow-up claim limits';
  end if;
  update public.real_estate_followups f
    set status='cancelled',lease_token=null,lease_until=null,last_error_code='FOLLOWUP_STOP_CONDITION'
  from public.real_estate_leads l
  where l.id=f.lead_id and l.workspace_id=f.workspace_id and f.status in ('pending','sending')
    and (l.consent_to_contact=false or l.customer_responded_at is not null or l.agent_takeover_at is not null or l.status in ('won','lost'));
  return query
  with due as (
    select f.id from public.real_estate_followups f
    join public.real_estate_leads l on l.id=f.lead_id and l.workspace_id=f.workspace_id
    where f.status='pending' and f.due_at <= now() and f.attempt_count < f.max_attempts
      and l.consent_to_contact=true and l.contact_preference='email'
      and l.email is not null and l.customer_responded_at is null and l.agent_takeover_at is null
      and l.status not in ('won','lost')
    order by f.due_at asc,f.id asc
    for update of f skip locked limit p_limit
  ),
  claimed as (
    update public.real_estate_followups f
    set status='sending',attempt_count=f.attempt_count+1,lease_token=gen_random_uuid(),
        lease_until=now()+make_interval(secs=>p_lease_seconds)
    from due where f.id=due.id
    returning f.id,f.workspace_id,f.lead_id,f.sequence,f.channel,f.due_at,f.status,f.subject,f.message,f.attempt_count,f.max_attempts,f.lease_token
  )
  select c.id,c.workspace_id,c.lead_id,c.sequence,c.channel,c.due_at,c.status,c.subject,c.message,c.attempt_count,c.max_attempts,c.lease_token
  from claimed c;
end;
$$;

create or replace function public.finish_real_estate_followup(
  p_followup_id uuid,p_lease_token uuid,p_accepted boolean,p_provider_message_id text default null,
  p_error_code text default null,p_retryable boolean default false
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare current_row public.real_estate_followups%rowtype;
begin
  select * into current_row from public.real_estate_followups
  where id=p_followup_id and status='sending' and lease_token=p_lease_token and lease_until > now()
  for update;
  if not found then return false; end if;
  if p_accepted then
    update public.real_estate_followups set status='sent',sent_at=now(),provider_message_id=left(p_provider_message_id,200),
      lease_token=null,lease_until=null,last_error_code=null where id=p_followup_id;
    insert into public.real_estate_followup_attempts(workspace_id,followup_id,attempt_number,status,provider_message_id)
    values(current_row.workspace_id,current_row.id,current_row.attempt_count,'accepted',left(p_provider_message_id,200));
  else
    update public.real_estate_followups set
      status=case when p_retryable and current_row.attempt_count < current_row.max_attempts then 'pending' else 'failed' end,
      due_at=case when p_retryable and current_row.attempt_count < current_row.max_attempts
        then now()+make_interval(mins=>least(60,5 * (2 ^ greatest(0,current_row.attempt_count-1))::integer)) else due_at end,
      lease_token=null,lease_until=null,last_error_code=case when p_error_code ~ '^[A-Z0-9_]{1,80}$' then p_error_code else 'FOLLOWUP_SEND_FAILED' end
    where id=p_followup_id;
    insert into public.real_estate_followup_attempts(workspace_id,followup_id,attempt_number,status,error_code)
    values(current_row.workspace_id,current_row.id,current_row.attempt_count,'failed',
      case when p_error_code ~ '^[A-Z0-9_]{1,80}$' then p_error_code else 'FOLLOWUP_SEND_FAILED' end);
  end if;
  return true;
end;
$$;
revoke all on function public.claim_due_real_estate_followups(integer,integer) from public,anon,authenticated;
revoke all on function public.finish_real_estate_followup(uuid,uuid,boolean,text,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_due_real_estate_followups(integer,integer) to service_role;
grant execute on function public.finish_real_estate_followup(uuid,uuid,boolean,text,text,boolean) to service_role;
