begin;
create table if not exists public.marketplace_license_seats(
 license_id uuid not null references public.marketplace_licenses(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete restrict,
 assigned_by uuid not null references auth.users(id) on delete restrict,
 assigned_at timestamptz not null default now(), revoked_at timestamptz,
 primary key(license_id,user_id)
);
create index if not exists marketplace_license_seats_active_idx on public.marketplace_license_seats(license_id) where revoked_at is null;
alter table public.marketplace_license_seats enable row level security;
revoke all on public.marketplace_license_seats from anon,authenticated;
grant all on public.marketplace_license_seats to service_role;
create or replace function public.marketplace_assign_license_seat(p_license_id uuid,p_user_id uuid,p_actor_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.marketplace_licenses%rowtype;used integer;
begin
 if auth.role()<>'service_role' then raise exception 'license_seat_service_role_required';end if;
 select * into l from public.marketplace_licenses where id=p_license_id and buyer_workspace_id=p_workspace_id for update;
 if not found or l.status<>'active' or l.expires_at is not null and l.expires_at<=now() or l.starts_at is not null and l.starts_at>now() then raise exception 'license_inactive';end if;
 if l.license_type not in ('seat','enterprise') or l.seats is null then raise exception 'license_not_seat_based';end if;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id) then raise exception 'user_not_workspace_member';end if;
 select count(*) into used from public.marketplace_license_seats where license_id=l.id and revoked_at is null;
 if exists(select 1 from public.marketplace_license_seats where license_id=l.id and user_id=p_user_id and revoked_at is null) then return jsonb_build_object('status','already_assigned','license_id',l.id);end if;
 if used>=l.seats then raise exception 'license_seat_limit';end if;
 insert into public.marketplace_license_seats(license_id,user_id,assigned_by) values(l.id,p_user_id,p_actor_id);
 return jsonb_build_object('status','assigned','license_id',l.id,'user_id',p_user_id,'used',used+1,'capacity',l.seats);
end $$;
revoke all on function public.marketplace_assign_license_seat(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_assign_license_seat(uuid,uuid,uuid,uuid) to service_role;
commit;
