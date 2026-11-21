-- Durable, workspace-scoped qualification and internal notification pipeline.
alter table public.real_estate_leads
  add column if not exists qualification_status text not null default 'pending'
    check (qualification_status in ('pending','succeeded','blocked','failed')),
  add column if not exists qualification_error_code varchar(80),
  add column if not exists qualification_summary text,
  add column if not exists suggested_reply text,
  add column if not exists qualified_at timestamptz,
  add column if not exists agent_notification_status text not null default 'pending'
    check (agent_notification_status in ('pending','accepted','blocked','failed','not_required')),
  add column if not exists agent_notification_error_code varchar(80),
  add column if not exists agent_notification_accepted_recipient_hashes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(agent_notification_accepted_recipient_hashes) = 'array'),
  add column if not exists agent_notified_at timestamptz,
  add column if not exists pipeline_status text not null default 'pending'
    check (pipeline_status in ('pending','processing','completed','blocked','failed')),
  add column if not exists pipeline_attempt_count smallint not null default 0
    check (pipeline_attempt_count between 0 and 20),
  add column if not exists pipeline_next_attempt_at timestamptz not null default now(),
  add column if not exists pipeline_lease_token uuid,
  add column if not exists pipeline_lease_until timestamptz,
  add column if not exists pipeline_last_error_code varchar(80),
  add constraint real_estate_pipeline_lease_pair
    check ((pipeline_lease_token is null) = (pipeline_lease_until is null));

create index if not exists real_estate_leads_pipeline_due_idx
  on public.real_estate_leads(pipeline_next_attempt_at, created_at)
  where pipeline_status in ('pending','blocked','failed');

create or replace function public.claim_due_real_estate_lead_pipeline(
  p_limit integer default 10,
  p_lease_seconds integer default 180,
  p_lead_id uuid default null,
  p_workspace_id uuid default null
) returns table(lead_id uuid, workspace_id uuid, lease_token uuid)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 50 or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception using errcode='22023',message='Invalid real-estate pipeline claim limits';
  end if;

  -- Recover jobs abandoned by a worker that exited before releasing its lease.
  update public.real_estate_leads
  set pipeline_status = case when pipeline_attempt_count < 20 then 'pending' else 'failed' end,
      pipeline_lease_token = null,
      pipeline_lease_until = null,
      pipeline_next_attempt_at = now(),
      pipeline_last_error_code = 'PIPELINE_WORKER_LEASE_EXPIRED'
  where pipeline_status = 'processing' and pipeline_lease_until <= now();

  return query
  with due as (
    select l.id
    from public.real_estate_leads l
    where l.pipeline_status in ('pending','blocked','failed')
      and l.pipeline_next_attempt_at <= now()
      and l.pipeline_attempt_count < 20
      and (p_lead_id is null or l.id = p_lead_id)
      and (p_workspace_id is null or l.workspace_id = p_workspace_id)
    order by l.pipeline_next_attempt_at asc, l.created_at asc, l.id asc
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.real_estate_leads l
    set pipeline_status = 'processing',
        pipeline_attempt_count = l.pipeline_attempt_count + 1,
        pipeline_lease_token = gen_random_uuid(),
        pipeline_lease_until = now() + make_interval(secs => p_lease_seconds)
    from due
    where l.id = due.id
    returning l.id, l.workspace_id, l.pipeline_lease_token
  )
  select c.id, c.workspace_id, c.pipeline_lease_token from claimed c;
end;
$$;

revoke all on function public.claim_due_real_estate_lead_pipeline(integer,integer,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_due_real_estate_lead_pipeline(integer,integer,uuid,uuid) to service_role;
