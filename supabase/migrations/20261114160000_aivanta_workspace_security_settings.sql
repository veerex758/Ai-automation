-- Workspace security policies with server-owned storage and auditable changes.
create table if not exists public.workspace_security_settings (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 allow_member_invites boolean not null default true,
 require_approval_for_live_actions boolean not null default true,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.workspace_security_settings enable row level security;
revoke all on public.workspace_security_settings from public,anon,authenticated;
grant all on public.workspace_security_settings to service_role;

insert into public.workspace_security_settings(workspace_id)
select id from public.workspaces
on conflict(workspace_id) do nothing;

create or replace function private.create_workspace_security_settings()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.workspace_security_settings(workspace_id) values(new.id) on conflict(workspace_id) do nothing;
 return new;
end $$;
revoke all on function private.create_workspace_security_settings() from public,anon,authenticated;
drop trigger if exists workspaces_create_security_settings on public.workspaces;
create trigger workspaces_create_security_settings after insert on public.workspaces
for each row execute function private.create_workspace_security_settings();
