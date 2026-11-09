-- API key access audit trail without storing credentials or request payloads.
begin;
create table if not exists public.marketplace_api_key_audit(
 id uuid primary key default gen_random_uuid(),key_id uuid references public.marketplace_api_keys(id) on delete set null,
 owner_user_id uuid references auth.users(id) on delete set null,
 action text not null check(action in ('created','revoked','read','publish','scope_denied','rate_limited')),
 endpoint text not null check(length(endpoint) between 1 and 120),
 outcome text not null check(outcome in ('success','denied','limited')),
 created_at timestamptz not null default now()
);
create index if not exists marketplace_api_key_audit_owner_idx on public.marketplace_api_key_audit(owner_user_id,created_at desc);
create index if not exists marketplace_api_key_audit_key_idx on public.marketplace_api_key_audit(key_id,created_at desc);
alter table public.marketplace_api_key_audit enable row level security;
revoke all on public.marketplace_api_key_audit from anon,authenticated;
grant all on public.marketplace_api_key_audit to service_role;
create or replace function public.marketplace_audit_api_key_event(p_key_id uuid,p_owner_user_id uuid,p_action text,p_endpoint text,p_outcome text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()<>'service_role' then raise exception 'api_key_audit_service_role_required';end if;
 if p_action not in ('created','revoked','read','publish','scope_denied','rate_limited') or p_outcome not in ('success','denied','limited') or nullif(trim(p_endpoint),'') is null or length(p_endpoint)>120 then raise exception 'invalid_api_key_audit';end if;
 insert into public.marketplace_api_key_audit(key_id,owner_user_id,action,endpoint,outcome) values(p_key_id,p_owner_user_id,p_action,p_endpoint,p_outcome);
end $$;
revoke all on function public.marketplace_audit_api_key_event(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_audit_api_key_event(uuid,uuid,text,text,text) to service_role;
commit;
