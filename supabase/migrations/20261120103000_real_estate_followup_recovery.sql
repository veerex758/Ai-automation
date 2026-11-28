-- Enforce workspace ownership for assigned real-estate agents and recover expired queue leases.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'real_estate_leads_agent_workspace_fk'
      and conrelid = 'public.real_estate_leads'::regclass
  ) then
    alter table public.real_estate_leads
      add constraint real_estate_leads_agent_workspace_fk
      foreign key (workspace_id, assigned_agent_id)
      references public.agents(workspace_id, id)
      on delete restrict;
  end if;
end;
$$;

create or replace function public.claim_due_real_estate_followups(p_limit integer default 25,p_lease_seconds integer default 180)
returns table(id uuid,workspace_id uuid,lead_id uuid,sequence smallint,channel text,due_at timestamptz,status text,subject text,message text,attempt_count smallint,max_attempts smallint,lease_token uuid)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception using errcode='22023',message='Invalid follow-up claim limits';
  end if;

  -- Requeue a job whose worker lease expired. The stable provider idempotency
  -- key makes retry safe even when the previous request timed out after acceptance.
  update public.real_estate_followups f
  set status = case when f.attempt_count < f.max_attempts then 'pending' else 'failed' end,
      due_at = case when f.attempt_count < f.max_attempts then now() else f.due_at end,
      lease_token = null, lease_until = null,
      last_error_code = 'FOLLOWUP_WORKER_LEASE_EXPIRED'
  where f.status = 'sending' and f.lease_until <= now();

  update public.real_estate_followups f
  set status='cancelled',lease_token=null,lease_until=null,last_error_code='FOLLOWUP_STOP_CONDITION'
  from public.real_estate_leads l
  where l.id=f.lead_id and l.workspace_id=f.workspace_id and f.status in ('pending','sending')
    and (l.consent_to_contact=false or l.customer_responded_at is not null or
      l.agent_takeover_at is not null or l.status in ('won','lost') or
      l.contact_preference <> 'email' or l.email is null);

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
    returning f.id,f.workspace_id,f.lead_id,f.sequence,f.channel,f.due_at,f.status,
      f.subject,f.message,f.attempt_count,f.max_attempts,f.lease_token
  )
  select c.id,c.workspace_id,c.lead_id,c.sequence,c.channel,c.due_at,c.status,
    c.subject,c.message,c.attempt_count,c.max_attempts,c.lease_token
  from claimed c;
end;
$$;
