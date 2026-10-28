-- Webhook endpoint metadata and idempotent event receipts.
-- Secrets are stored only as ciphertext; application code must encrypt/decrypt with
-- a separately managed key before writing/reading secret_ciphertext.
create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  endpoint_key_hash text not null unique check (length(endpoint_key_hash) = 64),
  secret_ciphertext bytea not null,
  secret_key_version text not null check (length(trim(secret_key_version)) between 1 and 80),
  status text not null default 'disabled' check (status in ('disabled', 'active', 'revoked')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_received_at timestamptz,
  constraint webhook_endpoint_workflow_workspace_fk
    foreign key (workflow_id, workspace_id)
    references public.workflows(id, workspace_id) on delete cascade
);

create unique index if not exists webhook_endpoints_one_live_per_workflow_idx
  on public.webhook_endpoints(workflow_id)
  where status in ('active', 'disabled');

create table if not exists public.webhook_event_receipts (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id text not null check (length(event_id) between 1 and 200),
  event_type text not null check (length(event_type) between 1 and 200),
  payload_sha256 text not null check (length(payload_sha256) = 64),
  status text not null default 'accepted' check (status in ('accepted', 'dispatched', 'failed')),
  received_at timestamptz not null default now(),
  dispatched_at timestamptz,
  failure_code text,
  unique (endpoint_id, event_id)
);

create index if not exists webhook_event_receipts_endpoint_received_idx
  on public.webhook_event_receipts(endpoint_id, received_at desc);

create trigger webhook_endpoints_set_updated_at
  before update on public.webhook_endpoints
  for each row execute function public.set_updated_at();

alter table public.webhook_endpoints enable row level security;
alter table public.webhook_event_receipts enable row level security;

-- No client-facing policies: these tables contain endpoint identifiers, encrypted
-- secrets and event metadata. Access is restricted to trusted server-side service_role.
revoke all on public.webhook_endpoints, public.webhook_event_receipts from public, anon, authenticated;
grant all on public.webhook_endpoints, public.webhook_event_receipts to service_role;

create or replace function public.claim_webhook_event(
  target_endpoint_id uuid,
  target_event_id text,
  target_event_type text,
  target_payload_sha256 text
)
returns table (accepted boolean, receipt_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_id uuid;
begin
  if target_event_id is null or length(target_event_id) < 1 or length(target_event_id) > 200
     or target_event_type is null or length(target_event_type) < 1 or length(target_event_type) > 200
     or target_payload_sha256 is null or target_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid webhook event receipt';
  end if;

  insert into public.webhook_event_receipts(endpoint_id, event_id, event_type, payload_sha256)
  select e.id, target_event_id, target_event_type, target_payload_sha256
  from public.webhook_endpoints e
  where e.id = target_endpoint_id and e.status = 'active'
  on conflict (endpoint_id, event_id) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    return query select false, r.id
      from public.webhook_event_receipts r
      where r.endpoint_id = target_endpoint_id and r.event_id = target_event_id;
  else
    update public.webhook_endpoints
      set last_received_at = now()
      where id = target_endpoint_id;
    return query select true, inserted_id;
  end if;
end;
$$;

revoke all on function public.claim_webhook_event(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_webhook_event(uuid, text, text, text) to service_role;
