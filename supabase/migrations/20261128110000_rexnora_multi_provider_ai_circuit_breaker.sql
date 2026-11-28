-- Generalize the shared AI provider circuit from Gemini-only to every
-- platform provider. Vercel instances coordinate through this Supabase state.
alter table private.ai_provider_circuit_breakers
  drop constraint if exists ai_provider_circuit_breakers_provider_check;

alter table private.ai_provider_circuit_breakers
  add constraint ai_provider_circuit_breakers_provider_check
  check (provider in ('gemini', 'groq', 'cloudflare'));

alter table private.ai_provider_circuit_breakers
  add column if not exists recent_attempts integer not null default 0 check (recent_attempts >= 0),
  add column if not exists recent_failures integer not null default 0 check (recent_failures >= 0),
  add column if not exists recent_failure_rate numeric(6,5) not null default 0
    check (recent_failure_rate between 0 and 1),
  add column if not exists last_failure_at timestamptz;

create table if not exists private.ai_provider_circuit_events (
  id bigint generated always as identity primary key,
  provider text not null references private.ai_provider_circuit_breakers(provider) on delete cascade,
  succeeded boolean not null,
  status_code integer check (status_code is null or status_code between 100 and 599),
  occurred_at timestamptz not null default clock_timestamp()
);

create index if not exists ai_provider_circuit_events_provider_time_idx
  on private.ai_provider_circuit_events(provider, occurred_at desc);

alter table private.ai_provider_circuit_events enable row level security;
revoke all on private.ai_provider_circuit_events from public, anon, authenticated, service_role;
grant usage on schema private to service_role;

insert into private.ai_provider_circuit_breakers(provider)
values ('gemini'), ('groq'), ('cloudflare')
on conflict (provider) do nothing;

create or replace function private.get_ai_provider_circuit_state(p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.ai_provider_circuit_breakers%rowtype;
  v_now timestamptz := clock_timestamp();
  v_retry_ms bigint;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider not in ('gemini', 'groq', 'cloudflare') then
    raise exception 'unsupported AI provider' using errcode = '22023';
  end if;

  insert into private.ai_provider_circuit_breakers(provider)
  values (p_provider)
  on conflict (provider) do nothing;

  select * into v_row
  from private.ai_provider_circuit_breakers
  where provider = p_provider
  for update;

  if v_row.open_until is not null and v_row.open_until > v_now then
    v_retry_ms := greatest(1, ceil(extract(epoch from (v_row.open_until - v_now)) * 1000)::bigint);
    return jsonb_build_object(
      'allowed', false,
      'state', 'open',
      'probe', false,
      'retryAfterMs', v_retry_ms,
      'consecutiveFailures', v_row.consecutive_failures,
      'recentAttempts', v_row.recent_attempts,
      'recentFailures', v_row.recent_failures,
      'recentFailureRate', v_row.recent_failure_rate,
      'lastStatusCode', v_row.last_status_code
    );
  end if;

  if v_row.open_until is not null then
    if v_row.probe_until is not null and v_row.probe_until > v_now then
      v_retry_ms := greatest(1, ceil(extract(epoch from (v_row.probe_until - v_now)) * 1000)::bigint);
      return jsonb_build_object(
        'allowed', false,
        'state', 'half_open',
        'probe', false,
        'retryAfterMs', v_retry_ms,
        'consecutiveFailures', v_row.consecutive_failures,
        'recentAttempts', v_row.recent_attempts,
        'recentFailures', v_row.recent_failures,
        'recentFailureRate', v_row.recent_failure_rate,
        'lastStatusCode', v_row.last_status_code
      );
    end if;

    -- The row lock makes this a single atomic probe lease across all instances.
    update private.ai_provider_circuit_breakers
    set probe_until = v_now + interval '25 seconds', updated_at = v_now
    where provider = p_provider;

    return jsonb_build_object(
      'allowed', true,
      'state', 'half_open',
      'probe', true,
      'retryAfterMs', 0,
      'consecutiveFailures', v_row.consecutive_failures,
      'recentAttempts', v_row.recent_attempts,
      'recentFailures', v_row.recent_failures,
      'recentFailureRate', v_row.recent_failure_rate,
      'lastStatusCode', v_row.last_status_code
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'state', 'closed',
    'probe', false,
    'retryAfterMs', 0,
    'consecutiveFailures', v_row.consecutive_failures,
    'recentAttempts', v_row.recent_attempts,
    'recentFailures', v_row.recent_failures,
    'recentFailureRate', v_row.recent_failure_rate,
    'lastStatusCode', v_row.last_status_code
  );
end
$$;

-- Replace the Gemini-only five-argument writer with a provider-neutral writer.
drop function if exists public.record_ai_provider_circuit_result(text, boolean, integer, bigint, boolean);
drop function if exists private.record_ai_provider_circuit_result(text, boolean, integer, bigint, boolean);

create function private.record_ai_provider_circuit_result(
  p_provider text,
  p_success boolean,
  p_status_code integer default null,
  p_retry_after_ms bigint default 0,
  p_probe boolean default false,
  p_failure_threshold integer default 3,
  p_failure_rate_threshold numeric default 0.5,
  p_minimum_requests integer default 5,
  p_window_seconds integer default 300,
  p_base_cooldown_ms bigint default 30000,
  p_max_cooldown_ms bigint default 300000,
  p_auth_cooldown_ms bigint default 300000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.ai_provider_circuit_breakers%rowtype;
  v_now timestamptz := clock_timestamp();
  v_event_id bigint;
  v_attempts integer;
  v_failures integer;
  v_failure_rate numeric(6,5);
  v_consecutive_failures integer;
  v_should_open boolean := false;
  v_open_count integer;
  v_cooldown_ms bigint;
  v_open_until timestamptz;
  v_probe_until timestamptz;
  v_state text;
  v_retry_ms bigint := 0;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider not in ('gemini', 'groq', 'cloudflare')
     or p_success is null
     or (p_status_code is not null and p_status_code not between 100 and 599)
     or coalesce(p_retry_after_ms, 0) < 0
     or p_failure_threshold not between 1 and 20
     or p_failure_rate_threshold not between 0 and 1
     or p_minimum_requests not between 2 and 100
     or p_window_seconds not between 30 and 3600
     or p_base_cooldown_ms not between 1000 and 300000
     or p_max_cooldown_ms not between p_base_cooldown_ms and 600000
     or p_auth_cooldown_ms not between 1000 and 600000 then
    raise exception 'invalid AI provider circuit result or policy' using errcode = '22023';
  end if;

  insert into private.ai_provider_circuit_breakers(provider)
  values (p_provider)
  on conflict (provider) do nothing;

  select * into v_row
  from private.ai_provider_circuit_breakers
  where provider = p_provider
  for update;

  insert into private.ai_provider_circuit_events(provider, succeeded, status_code, occurred_at)
  values (p_provider, p_success, p_status_code, v_now)
  returning id into v_event_id;

  -- Bound storage while retaining more than the largest supported rolling window.
  delete from private.ai_provider_circuit_events
  where provider = p_provider
    and occurred_at < v_now - interval '2 hours';

  if p_success and p_probe then
    -- A successful recovery probe resets the rolling sample so stale failures
    -- cannot immediately reopen a circuit that has just recovered.
    delete from private.ai_provider_circuit_events
    where provider = p_provider and id <> v_event_id;
  end if;

  select count(*)::integer,
         count(*) filter (where not succeeded)::integer
    into v_attempts, v_failures
  from private.ai_provider_circuit_events
  where provider = p_provider
    and occurred_at >= v_now - make_interval(secs => p_window_seconds);

  v_failure_rate := case when v_attempts > 0 then v_failures::numeric / v_attempts else 0 end;
  v_consecutive_failures := case when p_success then 0 else v_row.consecutive_failures + 1 end;

  if p_success then
    -- A late success from an ordinary request must not clear a circuit another
    -- instance has opened. Only the acquired half-open probe may close it.
    if v_row.open_until is null or p_probe then
      update private.ai_provider_circuit_breakers
      set consecutive_failures = 0,
          open_until = null,
          probe_until = null,
          last_status_code = null,
          recent_attempts = v_attempts,
          recent_failures = v_failures,
          recent_failure_rate = v_failure_rate,
          updated_at = v_now
      where provider = p_provider;
    else
      update private.ai_provider_circuit_breakers
      set recent_attempts = v_attempts,
          recent_failures = v_failures,
          recent_failure_rate = v_failure_rate,
          updated_at = v_now
      where provider = p_provider;
    end if;
  else
    v_should_open :=
      p_status_code in (401, 403, 429)
      or v_consecutive_failures >= p_failure_threshold
      or (v_attempts >= p_minimum_requests and v_failure_rate >= p_failure_rate_threshold)
      or p_probe;

    if v_should_open then
      v_open_count := v_row.open_count + 1;
      if p_status_code = 429 then
        v_cooldown_ms := least(600000, greatest(1000, coalesce(nullif(p_retry_after_ms, 0), p_base_cooldown_ms)));
      elsif p_status_code in (401, 403) then
        v_cooldown_ms := p_auth_cooldown_ms;
      else
        v_cooldown_ms := least(
          p_max_cooldown_ms,
          p_base_cooldown_ms * (2 ^ least(v_row.open_count, 4))
        );
      end if;
      v_open_until := v_now + (v_cooldown_ms::text || ' milliseconds')::interval;

      update private.ai_provider_circuit_breakers
      set consecutive_failures = v_consecutive_failures,
          open_count = v_open_count,
          open_until = v_open_until,
          probe_until = null,
          last_status_code = p_status_code,
          last_failure_at = v_now,
          recent_attempts = v_attempts,
          recent_failures = v_failures,
          recent_failure_rate = v_failure_rate,
          updated_at = v_now
      where provider = p_provider;
    else
      update private.ai_provider_circuit_breakers
      set consecutive_failures = v_consecutive_failures,
          probe_until = null,
          last_status_code = p_status_code,
          last_failure_at = v_now,
          recent_attempts = v_attempts,
          recent_failures = v_failures,
          recent_failure_rate = v_failure_rate,
          updated_at = v_now
      where provider = p_provider;
    end if;
  end if;

  select * into v_row
  from private.ai_provider_circuit_breakers
  where provider = p_provider;

  v_state := case
    when v_row.open_until is not null and v_row.open_until > v_now then 'open'
    when v_row.open_until is not null then 'half_open'
    else 'closed'
  end;
  if v_row.open_until is not null and v_row.open_until > v_now then
    v_retry_ms := greatest(1, ceil(extract(epoch from (v_row.open_until - v_now)) * 1000)::bigint);
  end if;

  return jsonb_build_object(
    'state', v_state,
    'consecutiveFailures', v_row.consecutive_failures,
    'openCount', v_row.open_count,
    'openUntil', v_row.open_until,
    'probeUntil', v_row.probe_until,
    'retryAfterMs', v_retry_ms,
    'recentAttempts', v_row.recent_attempts,
    'recentFailures', v_row.recent_failures,
    'recentFailureRate', v_row.recent_failure_rate,
    'lastStatusCode', v_row.last_status_code
  );
end
$$;

revoke all on function private.get_ai_provider_circuit_state(text) from public, anon, authenticated, service_role;
revoke all on function private.record_ai_provider_circuit_result(text, boolean, integer, bigint, boolean, integer, numeric, integer, integer, bigint, bigint, bigint) from public, anon, authenticated, service_role;
grant execute on function private.get_ai_provider_circuit_state(text) to service_role;
grant execute on function private.record_ai_provider_circuit_result(text, boolean, integer, bigint, boolean, integer, numeric, integer, integer, bigint, bigint, bigint) to service_role;

create or replace function public.get_ai_provider_circuit_state(p_provider text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_ai_provider_circuit_state(p_provider);
$$;

create function public.record_ai_provider_circuit_result(
  p_provider text,
  p_success boolean,
  p_status_code integer default null,
  p_retry_after_ms bigint default 0,
  p_probe boolean default false,
  p_failure_threshold integer default 3,
  p_failure_rate_threshold numeric default 0.5,
  p_minimum_requests integer default 5,
  p_window_seconds integer default 300,
  p_base_cooldown_ms bigint default 30000,
  p_max_cooldown_ms bigint default 300000,
  p_auth_cooldown_ms bigint default 300000
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_ai_provider_circuit_result(
    p_provider, p_success, p_status_code, p_retry_after_ms, p_probe,
    p_failure_threshold, p_failure_rate_threshold, p_minimum_requests,
    p_window_seconds, p_base_cooldown_ms, p_max_cooldown_ms, p_auth_cooldown_ms
  );
$$;

revoke all on function public.get_ai_provider_circuit_state(text) from public, anon, authenticated;
revoke all on function public.record_ai_provider_circuit_result(text, boolean, integer, bigint, boolean, integer, numeric, integer, integer, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.get_ai_provider_circuit_state(text) to service_role;
grant execute on function public.record_ai_provider_circuit_result(text, boolean, integer, bigint, boolean, integer, numeric, integer, integer, bigint, bigint, bigint) to service_role;
