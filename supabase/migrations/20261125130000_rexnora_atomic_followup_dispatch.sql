-- Final database-owned consent and lease gate for real-estate follow-up sends.
-- Provider dispatch remains an external side effect; this records the exact
-- consent snapshot and rejects stale/withdrawn jobs at the last possible point.

alter table public.real_estate_followups
  add column if not exists dispatch_authorized_at timestamptz,
  add column if not exists dispatch_consent_at timestamptz,
  add column if not exists dispatch_consent_text text;

create table if not exists public.real_estate_followup_dispatch_authorizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.real_estate_leads(id) on delete cascade,
  followup_id uuid not null references public.real_estate_followups(id) on delete cascade,
  lease_token uuid not null,
  attempt_number smallint not null check (attempt_number > 0),
  consent_at timestamptz not null,
  consent_text text not null check (length(btrim(consent_text)) > 0),
  authorized_at timestamptz not null default now(),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (followup_id, lease_token)
);

create index if not exists real_estate_followup_dispatch_authorizations_workspace_idx
  on public.real_estate_followup_dispatch_authorizations(workspace_id, authorized_at desc);

alter table public.real_estate_followup_dispatch_authorizations enable row level security;
revoke all on public.real_estate_followup_dispatch_authorizations from public, anon, authenticated;
grant all on public.real_estate_followup_dispatch_authorizations to service_role;

create or replace function public.authorize_real_estate_followup_dispatch(
  p_followup_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_lead public.real_estate_leads%rowtype;
  current_followup public.real_estate_followups%rowtype;
  stable_key text;
begin
  -- Lock in a consistent order with consent updates: lead first, queue row second.
  select l.* into current_lead
  from public.real_estate_leads l
  join public.real_estate_followups f
    on f.lead_id = l.id and f.workspace_id = l.workspace_id
  where f.id = p_followup_id
  for update of l;

  if not found then
    return false;
  end if;

  select f.* into current_followup
  from public.real_estate_followups f
  where f.id = p_followup_id
    and f.workspace_id = current_lead.workspace_id
  for update;

  if not found
    or current_followup.status <> 'sending'
    or current_followup.lease_token is distinct from p_lease_token
    or current_followup.lease_until is null
    or current_followup.lease_until <= now()
    or current_followup.channel <> 'email' then
    return false;
  end if;

  if current_lead.consent_to_contact is distinct from true
    or current_lead.consent_at is null
    or current_lead.consent_text is null
    or length(btrim(current_lead.consent_text)) = 0
    or current_lead.contact_preference <> 'email'
    or current_lead.email is null
    or current_lead.customer_responded_at is not null
    or current_lead.agent_takeover_at is not null
    or current_lead.status in ('won', 'lost') then
    update public.real_estate_followups
    set status = 'cancelled',
        lease_token = null,
        lease_until = null,
        last_error_code = 'FOLLOWUP_CONSENT_OR_STOP_CONDITION'
    where id = current_followup.id
      and workspace_id = current_followup.workspace_id
      and lease_token = p_lease_token;
    return false;
  end if;

  stable_key := 'real-estate-followup:' || current_followup.id::text;

  insert into public.real_estate_followup_dispatch_authorizations (
    workspace_id, lead_id, followup_id, lease_token, attempt_number,
    consent_at, consent_text, idempotency_key
  ) values (
    current_followup.workspace_id, current_lead.id, current_followup.id,
    p_lease_token, current_followup.attempt_count, current_lead.consent_at,
    current_lead.consent_text, stable_key
  )
  on conflict (followup_id, lease_token) do nothing;

  update public.real_estate_followups
  set dispatch_authorized_at = now(),
      dispatch_consent_at = current_lead.consent_at,
      dispatch_consent_text = current_lead.consent_text
  where id = current_followup.id
    and workspace_id = current_followup.workspace_id
    and lease_token = p_lease_token;

  return true;
end;
$$;

revoke all on function public.authorize_real_estate_followup_dispatch(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.authorize_real_estate_followup_dispatch(uuid, uuid)
  to service_role;

-- Stop queued and leased-but-not-yet-authorized jobs on consent withdrawal,
-- customer response, takeover or closure. A provider request already accepted
-- by an external system cannot be recalled by PostgreSQL.
create or replace function public.stop_real_estate_followups(
  p_workspace_id uuid,
  p_lead_id uuid,
  p_reason text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then
    raise exception using errcode='42501',message='Workspace membership required';
  end if;
  if p_reason not in ('CUSTOMER_RESPONDED','AGENT_TAKEOVER','CONSENT_WITHDRAWN','LEAD_CLOSED') then
    raise exception using errcode='22023',message='Invalid follow-up stop reason';
  end if;
  if not exists(
    select 1 from public.real_estate_leads l
    where l.id=p_lead_id and l.workspace_id=p_workspace_id
  ) then
    raise exception using errcode='P0002',message='Lead not found';
  end if;

  update public.real_estate_followups
  set status='cancelled',
      lease_token=null,
      lease_until=null,
      last_error_code='FOLLOWUP_STOP_CONDITION'
  where workspace_id=p_workspace_id
    and lead_id=p_lead_id
    and status in ('pending','sending');

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.stop_real_estate_followups(uuid,uuid,text) from public,anon;
grant execute on function public.stop_real_estate_followups(uuid,uuid,text) to authenticated;
