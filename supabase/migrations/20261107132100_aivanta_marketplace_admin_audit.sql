create table if not exists public.marketplace_admin_audit (
 id uuid primary key default gen_random_uuid(),actor_id uuid references auth.users(id) on delete set null,
 action text not null,entity_type text not null,entity_id uuid not null,details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.marketplace_admin_audit enable row level security;
revoke all on public.marketplace_admin_audit from anon,authenticated;
grant select,insert on public.marketplace_admin_audit to service_role;
create index if not exists marketplace_admin_audit_entity_idx on public.marketplace_admin_audit(entity_type,entity_id,created_at desc);
