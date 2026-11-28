-- Shared, database-backed Gemini circuit breaker.
-- State is global to the Supabase project so concurrent Vercel instances coordinate.
create schema if not exists private;

create table if not exists private.ai_provider_circuit_breakers (
  provider text primary key check (provider = 'gemini'),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  open_count integer not null default 0 check (open_count >= 0),
  open_until timestamptz,
  probe_until timestamptz,
  last_status_code integer check (last_status_code is null or last_status_code between 100 and 599),
  updated_at timestamptz not null default now()
);

alter table private.ai_provider_circuit_breakers enable row level security;
revoke all on private.ai_provider_circuit_breakers from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

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
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_provider is distinct from 'gemini' then
    raise exception 'unsupported AI provider' using errcode = '22023';
  end if;

  insert into private.ai_provider_circuit_breakers(provider)
  values ('gemini')
  on conflict (provider) do nothing;

  select * into v_row
  from private.ai_provider_circuit_breakers
  where provider = 'gemini'
  for update;

  if v_row.open_until is not null and v_row.open_until > v_now then
    v_retry_ms := greatest(1, ceil(extract(epoch from (v_row.open_until - v_now)) * 1000)::bigint);
    return jsonb_build_object(
      'allowed', false, 'state', 'open', 'probe', false,
      'retryAfterMs', v_retry_ms, 'lastStatusCode', v_row.last_status_code
    );
  end if;

  if v_row.open_until is not null then
    if v_row.probe_until is not null and v_row.probe_until > v_now then
      v_retry_ms := greatest(1, ceil(extract(epoch from (v_row.probe_until - v_now)) * 1000)::bigint);
      return jsonb_build_object(
        'allowed', false, 'state', 'half_open', 'probe', false,
        'retryAfterMs', v_retry_ms, 'lastStatusCode', v_row.last_status_code
      );
    end if;

    update private.ai_provider_circuit_breakers
    set probe_until = v_now + interval '25 seconds', updated_at = v_now
    where provider = 'gemini';

    return jsonb_build_object(
      'allowed', true, 'state', 'half_open', 'probe', true,
      'retryAfterMs', 0, 'lastStatusCode', v_row.last_status_code
    );
  end if;

  return jsonb_build_object(
    'allowed', true, 'state', 'closed', 'probe', false,
    'retryAfterMs', 0, 'lastStatusCode', v_row.last_status_code
  );
end
$$;

create or replace function private.record_ai_provider_circuit_result(
  p_provider text,
  p_success boolean,
  p_status_code integer default null,
  p_retry_after_ms bigint default 0,
  p_probe boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.ai_provider_circuit_breakers%rowtype;
  v_failures integer;
  v_open_count integer;
  v_cooldown_ms bigint;
  v_should_open boolean;
  v_now timestamptz := clock_timestamp();
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_provider is distinct from 'gemini'
     or p_success is null
     or (p_status_code is not null and p_status_code not between 100 and 599)
     or coalesce(p_retry_after_ms, 0) < 0 then
    raise exception 'invalid AI provider result' using errcode = '22023';
  end if;

  insert into private.ai_provider_circuit_breakers(provider)
  values ('gemini')
  on conflict (provider) do nothing;

  select * into v_row
  from private.ai_provider_circuit_breakers
  where provider = 'gemini'
  for update;

  if p_success then
    -- Only the half-open probe may close an already-open circuit. A late
    -- success from an older in-flight request must not erase a newer failure.
    if v_row.open_until is null or p_probe then
      update private.ai_provider_circuit_breakers
      set consecutive_failures = 0,
          open_until = null,
          probe_until = null,
          last_status_code = null,
          updated_at = v_now
      where provider = 'gemini';
    end if;
  elsif p_status_code is null or p_status_code in (408, 429, 500, 502, 503, 504) then
    v_failures := v_row.consecutive_failures + 1;
    v_should_open := p_status_code = 429 or v_failures >= 2 or p_probe;

    if v_should_open then
      v_open_count := v_row.open_count + 1;
      if p_status_code = 429 then
        v_cooldown_ms := least(600000, greatest(30000, coalesce(p_retry_after_ms, 0)));
      else
        v_cooldown_ms := least(300000, 30000 * (2 ^ least(v_row.open_count, 4)));
      end if;

      update private.ai_provider_circuit_breakers
      set consecutive_failures = v_failures,
          open_count = v_open_count,
          open_until = v_now + (v_cooldown_ms::text || ' milliseconds')::interval,
          probe_until = null,
          last_status_code = p_status_code,
          updated_at = v_now
      where provider = 'gemini';
    else
      update private.ai_provider_circuit_breakers
      set consecutive_failures = v_failures,
          probe_until = null,
          last_status_code = p_status_code,
          updated_at = v_now
      where provider = 'gemini';
    end if;
  end if;

  select * into v_row
  from private.ai_provider_circuit_breakers
  where provider = 'gemini';

  return jsonb_build_object(
    'state', case
      when v_row.open_until is not null and v_row.open_until > clock_timestamp() then 'open'
      when v_row.open_until is not null then 'half_open'
      else 'closed'
    end,
    'consecutiveFailures', v_row.consecutive_failures,
    'openCount', v_row.open_count,
    'openUntil', v_row.open_until,
    'lastStatusCode', v_row.last_status_code
  );
end
$$;

revoke all on function private.get_ai_provider_circuit_state(text) from public, anon, authenticated, service_role;
revoke all on function private.record_ai_provider_circuit_result(text, boolean, integer, bigint, boolean) from public, anon, authenticated, service_role;
grant execute on function private.get_ai_provider_circuit_state(text) to authenticated;
grant execute on function private.record_ai_provider_circuit_result(text, boolean, integer, bigint, boolean) to authenticated;

-- PostgREST exposes the public SECURITY INVOKER wrappers only. Privileged
-- state mutation remains inside the unexposed private schema.
create or replace function public.get_ai_provider_circuit_state(p_provider text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_ai_provider_circuit_state(p_provider);
$$;

create or replace function public.record_ai_provider_circuit_result(
  p_provider text,
  p_success boolean,
  p_status_code integer default null,
  p_retry_after_ms bigint default 0,
  p_probe boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_ai_provider_circuit_result(
    p_provider, p_success, p_status_code, p_retry_after_ms, p_probe
  );
$$;

revoke all on function public.get_ai_provider_circuit_state(text) from public, anon;
revoke all on function public.record_ai_provider_circuit_result(text, boolean, integer, bigint, boolean) from public, anon;
grant execute on function public.get_ai_provider_circuit_state(text) to authenticated;
grant execute on function public.record_ai_provider_circuit_result(text, boolean, integer, bigint, boolean) to authenticated;
