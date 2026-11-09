begin;
create table if not exists public.marketplace_api_key_rate_limits(
 api_key_id uuid not null references public.marketplace_api_keys(id) on delete cascade,
 window_start timestamptz not null,request_count integer not null check(request_count>=0),
 primary key(api_key_id,window_start)
);
alter table public.marketplace_api_key_rate_limits enable row level security;
revoke all on public.marketplace_api_key_rate_limits from anon,authenticated;
grant all on public.marketplace_api_key_rate_limits to service_role;
create or replace function public.marketplace_consume_api_rate_limit(p_key_id uuid,p_limit integer default 60,p_window_seconds integer default 60)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare bucket timestamptz; count integer;
begin
 if auth.role()<>'service_role' then raise exception 'api_rate_limit_service_role_required';end if;
 if p_limit<1 or p_limit>1000 or p_window_seconds<1 or p_window_seconds>3600 then raise exception 'invalid_rate_limit';end if;
 bucket:=to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);
 insert into public.marketplace_api_key_rate_limits(api_key_id,window_start,request_count) values(p_key_id,bucket,1)
 on conflict(api_key_id,window_start) do update set request_count=marketplace_api_key_rate_limits.request_count+1
 returning request_count into count;
 delete from public.marketplace_api_key_rate_limits where window_start<bucket-interval '2 hours';
 return jsonb_build_object('allowed',count<=p_limit,'limit',p_limit,'remaining',greatest(0,p_limit-count),'resetAt',bucket+make_interval(secs=>p_window_seconds));
end $$;
revoke all on function public.marketplace_consume_api_rate_limit(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.marketplace_consume_api_rate_limit(uuid,integer,integer) to service_role;
commit;
