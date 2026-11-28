-- Durable real-estate CRM sync outcomes and retry metadata for consent-based WhatsApp.
-- Additive only: preserve existing delivery rows and migration history.

alter table public.real_estate_channel_deliveries
  add column if not exists attempt_count smallint not null default 0,
  add column if not exists max_attempts smallint not null default 3,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_attempt_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'real_estate_channel_deliveries_attempt_count_check') then
    alter table public.real_estate_channel_deliveries
      add constraint real_estate_channel_deliveries_attempt_count_check
      check (attempt_count >= 0 and attempt_count <= 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'real_estate_channel_deliveries_max_attempts_check') then
    alter table public.real_estate_channel_deliveries
      add constraint real_estate_channel_deliveries_max_attempts_check
      check (max_attempts between 1 and 10 and attempt_count <= max_attempts);
  end if;
end $$;

create index if not exists real_estate_channel_deliveries_retry_idx
  on public.real_estate_channel_deliveries(status,next_attempt_at,created_at)
  where status = 'failed';

create table if not exists public.real_estate_crm_syncs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.real_estate_leads(id) on delete cascade,
  provider text not null,
  status text not null default 'pending',
  idempotency_key varchar not null,
  provider_contact_id varchar,
  attempt_count smallint not null default 0,
  max_attempts smallint not null default 3,
  last_error_code varchar,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_crm_syncs_provider_check
    check (provider in ('pipedrive','zoho_crm','freshsales')),
  constraint real_estate_crm_syncs_status_check
    check (status in ('pending','searching','creating','matched','created','unknown','failed','blocked')),
  constraint real_estate_crm_syncs_attempt_count_check
    check (attempt_count >= 0 and attempt_count <= max_attempts and max_attempts between 1 and 10),
  constraint real_estate_crm_syncs_idempotency_unique unique (workspace_id,idempotency_key),
  constraint real_estate_crm_syncs_lead_provider_unique unique (workspace_id,lead_id,provider)
);

create index if not exists real_estate_crm_syncs_workspace_status_idx
  on public.real_estate_crm_syncs(workspace_id,status,updated_at desc);
create index if not exists real_estate_crm_syncs_lead_idx
  on public.real_estate_crm_syncs(workspace_id,lead_id,created_at desc);

alter table public.real_estate_crm_syncs enable row level security;
drop policy if exists real_estate_crm_syncs_member_read on public.real_estate_crm_syncs;
create policy real_estate_crm_syncs_member_read on public.real_estate_crm_syncs
  for select to authenticated using (private.is_workspace_member(workspace_id));

revoke all on public.real_estate_crm_syncs from anon, authenticated;
grant select on public.real_estate_crm_syncs to authenticated;
grant all on public.real_estate_crm_syncs to service_role;
