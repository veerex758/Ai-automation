-- Explicit, auditable allowlist for agency-side lead qualification alerts.
-- Only workspace owners/admins can add, re-approve or revoke recipients.

create table if not exists public.real_estate_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email varchar(254) not null
    check (email = lower(btrim(email)))
    check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'),
  active boolean not null default true,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email),
  constraint real_estate_notification_recipient_revocation_state
    check (
      (active = true and revoked_by is null and revoked_at is null)
      or (active = false and revoked_by is not null and revoked_at is not null)
    )
);

create index if not exists real_estate_notification_recipients_active_idx
  on public.real_estate_notification_recipients(workspace_id, created_at)
  where active = true;

drop trigger if exists real_estate_notification_recipients_updated_at
  on public.real_estate_notification_recipients;
create trigger real_estate_notification_recipients_updated_at
  before update on public.real_estate_notification_recipients
  for each row execute function public.set_updated_at();

alter table public.real_estate_notification_recipients enable row level security;

create policy real_estate_notification_recipients_select
  on public.real_estate_notification_recipients
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy real_estate_notification_recipients_insert
  on public.real_estate_notification_recipients
  for insert to authenticated
  with check (
    private.is_workspace_admin(workspace_id)
    and approved_by = auth.uid()
    and active = true
    and revoked_by is null
    and revoked_at is null
  );

create policy real_estate_notification_recipients_update
  on public.real_estate_notification_recipients
  for update to authenticated
  using (private.is_workspace_admin(workspace_id))
  with check (private.is_workspace_admin(workspace_id));

grant select, insert, update on public.real_estate_notification_recipients to authenticated;
revoke all on public.real_estate_notification_recipients from anon, public;
revoke delete, truncate, references, trigger
  on public.real_estate_notification_recipients from authenticated;
grant all on public.real_estate_notification_recipients to service_role;
