-- Explicit, auditable allowlist for agency-side lead qualification alerts.
-- Only workspace owners/admins can add, re-approve or revoke recipients.

create table if not exists public.real_estate_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email varchar(254) not null
    check (email = lower(btrim(email)))
    check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  active boolean not null default true,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete restrict,
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

create or replace function public.enforce_real_estate_notification_recipient_audit()
returns trigger
language plpgsql
set search_path = ''
as $audit$
begin
  if auth.uid() is null then
    raise exception 'Authenticated workspace admin required' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.approved_by := auth.uid();
    new.approved_at := now();
    new.revoked_by := null;
    new.revoked_at := null;
    new.active := true;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.workspace_id is distinct from old.workspace_id
    or new.email is distinct from old.email
    or new.created_at is distinct from old.created_at then
    raise exception 'Recipient identity is immutable' using errcode = '42501';
  end if;

  if old.active and not new.active then
    new.revoked_by := auth.uid();
    new.revoked_at := now();
  elsif not old.active and new.active then
    new.approved_by := auth.uid();
    new.approved_at := now();
    new.revoked_by := null;
    new.revoked_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    new.revoked_by := old.revoked_by;
    new.revoked_at := old.revoked_at;
  end if;

  new.updated_at := now();
  return new;
end;
$audit$;

revoke all on function public.enforce_real_estate_notification_recipient_audit()
  from public, anon, authenticated;

drop trigger if exists real_estate_notification_recipients_updated_at
  on public.real_estate_notification_recipients;
create trigger real_estate_notification_recipients_enforce_audit
  before insert or update on public.real_estate_notification_recipients
  for each row execute function public.enforce_real_estate_notification_recipient_audit();

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

revoke all on public.real_estate_notification_recipients from anon, authenticated, public;
grant select on public.real_estate_notification_recipients to authenticated;
grant insert (workspace_id, email, active)
  on public.real_estate_notification_recipients to authenticated;
grant update (active)
  on public.real_estate_notification_recipients to authenticated;
grant all on public.real_estate_notification_recipients to service_role;
