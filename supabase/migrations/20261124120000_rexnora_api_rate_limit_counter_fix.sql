-- Correct the shared API limiter so requests beyond the threshold are rejected.
-- Saturate at limit + 1 to avoid unbounded counters while preserving the blocked state.

alter table public.api_rate_limit_buckets
  drop constraint if exists api_rate_limit_buckets_hit_count_check;
alter table public.api_rate_limit_buckets
  add constraint api_rate_limit_buckets_hit_count_check
  check (hit_count between 1 and 10001);

create or replace function public.consume_api_rate_limit(
  p_scope text, p_key text, p_limit integer, p_window_ms integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  now_at timestamptz := clock_timestamp();
  key_digest text;
  bucket public.api_rate_limit_buckets%rowtype;
  allowed boolean;
  remaining integer;
  retry_ms integer;
begin
  if p_scope is null or p_scope !~ '^[a-z][a-z0-9:_-]{1,79}$'
     or p_key is null or length(p_key) not between 1 and 512
     or p_limit is null or p_limit not between 1 and 10000
     or p_window_ms is null or p_window_ms not between 100 and 86400000 then
    raise exception using errcode='22023', message='Invalid API rate limit request';
  end if;
  key_digest := md5(p_key);
  delete from public.api_rate_limit_buckets
  where ctid in (
    select ctid from public.api_rate_limit_buckets
    where updated_at < now_at - interval '24 hours'
    order by updated_at limit 500
  );
  insert into public.api_rate_limit_buckets as current_bucket
    (scope, key_hash, window_started_at, hit_count, updated_at)
  values (p_scope, key_digest, now_at, 1, now_at)
  on conflict (scope, key_hash) do update
    set window_started_at = case
          when current_bucket.window_started_at + (p_window_ms * interval '1 millisecond') <= now_at
          then now_at else current_bucket.window_started_at end,
        hit_count = case
          when current_bucket.window_started_at + (p_window_ms * interval '1 millisecond') <= now_at then 1
          else least(current_bucket.hit_count + 1, p_limit + 1)
        end,
        updated_at = now_at
  returning * into bucket;
  allowed := bucket.hit_count <= p_limit;
  remaining := greatest(0, p_limit - bucket.hit_count);
  if allowed then retry_ms := 0;
  else retry_ms := greatest(1, ceil(extract(epoch from (
    bucket.window_started_at + (p_window_ms * interval '1 millisecond') - now_at
  )) * 1000)::integer);
  end if;
  return jsonb_build_object('allowed',allowed,'remaining',remaining,'retryAfterMs',retry_ms);
end;
$$;
revoke all on function public.consume_api_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text,text,integer,integer) to service_role;
