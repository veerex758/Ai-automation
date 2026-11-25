-- Serialize the final follow-up dispatch authorization with consent changes.
-- A revocation committed before this function runs blocks delivery. If this
-- function authorizes first, that delivery is already in flight and may finish.
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
  v_lead_id uuid;
  v_lead public.real_estate_leads%rowtype;
  v_followup public.real_estate_followups%rowtype;
begin
  if p_workspace_id is null or p_followup_id is null or p_lease_token is null
     or p_expected_email is null or length(pg_catalog.btrim(p_expected_email)) = 0 then
    return false;
  end if;

  -- Lock the lead first, matching the consent-withdrawal route's lead update,
  -- then lock the exact leased follow-up row.
  select f.lead_id
    into v_lead_id
    from public.real_estate_followups f
   where f.id = p_followup_id
     and f.workspace_id = p_workspace_id;

  if not found then
    return false;
  end if;

  select l.*
    into v_lead
    from public.real_estate_leads l
   where l.id = v_lead_id
     and l.workspace_id = p_workspace_id
   for update;

  if not found then
    return false;
  end if;

  select f.*
    into v_followup
    from public.real_estate_followups f
   where f.id = p_followup_id
     and f.workspace_id = p_workspace_id
   for update;

  if not found
     or v_followup.status <> 'sending'
     or v_followup.lease_token is distinct from p_lease_token
     or v_followup.lease_until is null
     or v_followup.lease_until <= now()
     or v_followup.due_at > now()
     or v_followup.channel <> 'email' then
    return false;
  end if;

  if v_lead.consent_to_contact is distinct from true
     or v_lead.consent_at is null
     or nullif(pg_catalog.btrim(v_lead.consent_text), '') is null
     or v_lead.contact_preference is distinct from 'email'
     or nullif(pg_catalog.btrim(v_lead.email), '') is null
     or lower(pg_catalog.btrim(v_lead.email)) <> lower(pg_catalog.btrim(p_expected_email))
     or v_lead.customer_responded_at is not null
     or v_lead.agent_takeover_at is not null
     or v_lead.status in ('won', 'lost') then
    update public.real_estate_followups
       set status = 'cancelled',
           lease_token = null,
           lease_until = null,
           last_error_code = 'FOLLOWUP_STOP_CONDITION',
           updated_at = now()
     where id = p_followup_id
       and workspace_id = p_workspace_id
       and status = 'sending'
       and lease_token = p_lease_token;
    return false;
  end if;

  return true;
end;
$$;

comment on function public.authorize_real_estate_followup_dispatch(uuid,uuid,uuid,text) is
  'Atomically validates current email consent, lead stop conditions, recipient identity, due time and the exact worker lease before an external follow-up dispatch.';

revoke all on function public.authorize_real_estate_followup_dispatch(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.authorize_real_estate_followup_dispatch(uuid,uuid,uuid,text)
  to service_role;
