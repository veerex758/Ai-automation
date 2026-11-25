-- Harden the database-owned consent/lease gate and preserve the exact dispatch snapshot.
-- The RPC is the dispatch authorization point: a revocation committed before it
-- blocks the send; an already-authorized provider request may finish.

drop function if exists public.authorize_real_estate_followup_dispatch(uuid, uuid);

create or replace function public.authorize_real_estate_followup_dispatch(
  p_workspace_id uuid,
  p_followup_id uuid,
  p_lease_token uuid,
  p_expected_email text
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
  if p_workspace_id is null or p_followup_id is null or p_lease_token is null
     or p_expected_email is null or length(pg_catalog.btrim(p_expected_email)) = 0 then
    return false;
  end if;

  -- Lock order matches the lead update used by consent withdrawal: lead first,
  -- then the exact follow-up queue row.
  select l.* into current_lead
    from public.real_estate_leads l
    join public.real_estate_followups f
      on f.lead_id = l.id and f.workspace_id = l.workspace_id
   where f.id = p_followup_id
     and f.workspace_id = p_workspace_id
   for update of l;

  if not found then
    return false;
  end if;

  select f.* into current_followup
    from public.real_estate_followups f
   where f.id = p_followup_id
     and f.workspace_id = p_workspace_id
   for update;

  if not found
     or current_followup.status <> 'sending'
     or current_followup.lease_token is distinct from p_lease_token
     or current_followup.lease_until is null
     or current_followup.lease_until <= now()
     or current_followup.due_at > now()
     or current_followup.channel <> 'email' then
    return false;
  end if;

  if current_lead.consent_to_contact is distinct from true
     or current_lead.consent_at is null
     or nullif(pg_catalog.btrim(current_lead.consent_text), '') is null
     or current_lead.contact_preference is distinct from 'email'
     or nullif(pg_catalog.btrim(current_lead.email), '') is null
     or lower(pg_catalog.btrim(current_lead.email)) <> lower(pg_catalog.btrim(p_expected_email))
     or current_lead.customer_responded_at is not null
     or current_lead.agent_takeover_at is not null
     or current_lead.status in ('won', 'lost') then
    update public.real_estate_followups
       set status = 'cancelled',
           lease_token = null,
           lease_until = null,
           last_error_code = 'FOLLOWUP_CONSENT_OR_STOP_CONDITION',
           updated_at = now()
     where id = current_followup.id
       and workspace_id = current_followup.workspace_id
       and status = 'sending'
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
         dispatch_consent_text = current_lead.consent_text,
         updated_at = now()
   where id = current_followup.id
     and workspace_id = current_followup.workspace_id
     and status = 'sending'
     and lease_token = p_lease_token;

  return true;
end;
$$;

revoke all on function public.authorize_real_estate_followup_dispatch(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.authorize_real_estate_followup_dispatch(uuid, uuid, uuid, text)
  to service_role;

-- A stop request cancels all pending work and any leased work that has not yet
-- crossed the database authorization point. An authorized external request is
-- already in flight and cannot be recalled by PostgreSQL.
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
    raise exception using errcode='42501', message='Workspace membership required';
  end if;
  if p_reason not in ('CUSTOMER_RESPONDED','AGENT_TAKEOVER','CONSENT_WITHDRAWN','LEAD_CLOSED') then
    raise exception using errcode='22023', message='Invalid follow-up stop reason';
  end if;
  if not exists (
    select 1 from public.real_estate_leads l
     where l.id = p_lead_id and l.workspace_id = p_workspace_id
  ) then
    raise exception using errcode='P0002', message='Lead not found';
  end if;

  update public.real_estate_followups
     set status = 'cancelled',
         lease_token = null,
         lease_until = null,
         last_error_code = 'FOLLOWUP_STOP_CONDITION',
         updated_at = now()
   where workspace_id = p_workspace_id
     and lead_id = p_lead_id
     and status in ('pending','sending')
     and (status = 'pending' or dispatch_authorized_at is null);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.stop_real_estate_followups(uuid,uuid,text) from public, anon;
grant execute on function public.stop_real_estate_followups(uuid,uuid,text) to authenticated;

-- Reset the previous attempt's authorization snapshot whenever a fresh lease is
-- issued. The immutable authorization ledger keeps the prior attempt snapshot.
create or replace function public.claim_due_real_estate_followups(
  p_limit integer default 25,
  p_lease_seconds integer default 180
)
returns table(
  id uuid, workspace_id uuid, lead_id uuid, sequence smallint, channel text,
  due_at timestamptz, status text, subject text, message text,
  attempt_count smallint, max_attempts smallint, lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception using errcode='22023', message='Invalid follow-up claim limits';
  end if;

  update public.real_estate_followups f
     set status = case when f.attempt_count < f.max_attempts then 'pending' else 'failed' end,
         due_at = case when f.attempt_count < f.max_attempts then now() else f.due_at end,
         lease_token = null,
         lease_until = null,
         dispatch_authorized_at = null,
         dispatch_consent_at = null,
         dispatch_consent_text = null,
         last_error_code = 'FOLLOWUP_WORKER_LEASE_EXPIRED',
         updated_at = now()
   where f.status = 'sending'
     and f.lease_until <= now();

  update public.real_estate_followups f
     set status = 'cancelled',
         lease_token = null,
         lease_until = null,
         last_error_code = 'FOLLOWUP_STOP_CONDITION',
         updated_at = now()
    from public.real_estate_leads l
   where l.id = f.lead_id
     and l.workspace_id = f.workspace_id
     and f.status in ('pending','sending')
     and (f.status = 'pending' or f.dispatch_authorized_at is null)
     and (
       l.consent_to_contact is distinct from true
       or l.consent_at is null
       or nullif(pg_catalog.btrim(l.consent_text), '') is null
       or l.customer_responded_at is not null
       or l.agent_takeover_at is not null
       or l.status in ('won','lost')
       or l.contact_preference is distinct from 'email'
       or nullif(pg_catalog.btrim(l.email), '') is null
     );

  return query
  with due as (
    select f.id
      from public.real_estate_followups f
      join public.real_estate_leads l
        on l.id = f.lead_id and l.workspace_id = f.workspace_id
     where f.status = 'pending'
       and f.due_at <= now()
       and f.attempt_count < f.max_attempts
       and l.consent_to_contact = true
       and l.consent_at is not null
       and nullif(pg_catalog.btrim(l.consent_text), '') is not null
       and l.contact_preference = 'email'
       and nullif(pg_catalog.btrim(l.email), '') is not null
       and l.customer_responded_at is null
       and l.agent_takeover_at is null
       and l.status not in ('won','lost')
     order by f.due_at asc, f.id asc
     for update of f skip locked
     limit p_limit
  ), claimed as (
    update public.real_estate_followups f
       set status = 'sending',
           attempt_count = f.attempt_count + 1,
           lease_token = gen_random_uuid(),
           lease_until = now() + make_interval(secs => p_lease_seconds),
           dispatch_authorized_at = null,
           dispatch_consent_at = null,
           dispatch_consent_text = null,
           updated_at = now()
      from due
     where f.id = due.id
     returning f.id, f.workspace_id, f.lead_id, f.sequence, f.channel,
       f.due_at, f.status, f.subject, f.message, f.attempt_count,
       f.max_attempts, f.lease_token
  )
  select c.id, c.workspace_id, c.lead_id, c.sequence, c.channel,
    c.due_at, c.status, c.subject, c.message, c.attempt_count,
    c.max_attempts, c.lease_token
  from claimed c;
end;
$$;
