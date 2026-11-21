-- Authorized workspace members can stop pending customer follow-ups without
-- receiving permission to mutate worker lease fields or already-sent history.
create or replace function public.stop_real_estate_followups(
  p_workspace_id uuid,p_lead_id uuid,p_reason text
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare affected integer;
begin
  if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then
    raise exception using errcode='42501',message='Workspace membership required';
  end if;
  if p_reason not in ('CUSTOMER_RESPONDED','AGENT_TAKEOVER','CONSENT_WITHDRAWN','LEAD_CLOSED') then
    raise exception using errcode='22023',message='Invalid follow-up stop reason';
  end if;
  if not exists(select 1 from public.real_estate_leads l where l.id=p_lead_id and l.workspace_id=p_workspace_id) then
    raise exception using errcode='P0002',message='Lead not found';
  end if;
  update public.real_estate_followups
  set status='cancelled',lease_token=null,lease_until=null,last_error_code='FOLLOWUP_STOP_CONDITION'
  where workspace_id=p_workspace_id and lead_id=p_lead_id and status='pending';
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.stop_real_estate_followups(uuid,uuid,text) from public,anon;
grant execute on function public.stop_real_estate_followups(uuid,uuid,text) to authenticated;
