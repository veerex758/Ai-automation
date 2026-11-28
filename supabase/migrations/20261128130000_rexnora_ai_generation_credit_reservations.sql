-- Phase 5: one reservation/settlement lifecycle per logical AI generation.
-- Provider retries and schema repair share operation_id. Reservations are holds,
-- not consumed usage. Customer usage is written only after output validation.
create table if not exists private.ai_generation_credit_reservations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  operation_id uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'released')),
  period_start date not null default date_trunc('month', now())::date,
  actor_user_id uuid references auth.users(id) on delete set null,
  retry_count integer not null default 0 check (retry_count >= 0),
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  primary key (workspace_id, operation_id),
  check ((status = 'consumed') = (consumed_at is not null)),
  check ((status = 'released') = (released_at is not null))
);

create index if not exists ai_generation_credit_reservations_active_idx
  on private.ai_generation_credit_reservations(workspace_id, period_start, expires_at)
  where status = 'reserved';

alter table private.ai_generation_credit_reservations enable row level security;
revoke all on private.ai_generation_credit_reservations from public, anon, authenticated, service_role;

-- Provider token/cost telemetry is deliberately separate from customer usage.
-- Rows are written in the same transaction as final credit consumption, but do
-- not affect the workspace credit balance or quota.
create table if not exists private.ai_provider_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  operation_id uuid not null,
  provider text not null check (provider in ('gemini', 'groq', 'cloudflare')),
  model text not null check (length(model) between 1 and 128),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  provider_cost_usd numeric(18,12) check (provider_cost_usd is null or provider_cost_usd >= 0),
  fallback_used boolean not null default false,
  created_at timestamptz not null default now(),
  constraint ai_provider_usage_events_operation_fk
    foreign key (workspace_id, operation_id)
    references private.ai_generation_credit_reservations(workspace_id, operation_id)
    on delete cascade,
  constraint ai_provider_usage_events_operation_model_unique
    unique (workspace_id, operation_id, provider, model)
);

create index if not exists ai_provider_usage_events_workspace_time_idx
  on private.ai_provider_usage_events(workspace_id, created_at desc);

alter table private.ai_provider_usage_events enable row level security;
revoke all on private.ai_provider_usage_events from public, anon, authenticated, service_role;

-- Reserve one generation slot and one AI credit without inserting into
-- workspace_usage. The workspace advisory lock is shared with existing usage
-- and agent metering RPCs, making the hold visible to all concurrent spenders.
create or replace function public.reserve_ai_generation_usage(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text := 'free';
  v_status text := 'active';
  v_custom_ai integer;
  v_limit integer;
  v_ai bigint := 0;
  v_generations bigint := 0;
  v_reserved bigint := 0;
  v_period date := date_trunc('month', now())::date;
  v_actor uuid := auth.uid();
  v_existing private.ai_generation_credit_reservations%rowtype;
begin
  if v_actor is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_operation_id is null
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid AI generation reservation' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text, 0)
  );

  -- Expired reservations are released lazily, so a crashed server cannot hold
  -- quota forever. Expiry never creates a customer usage charge.
  update private.ai_generation_credit_reservations
  set status = 'released',
      released_at = now(),
      release_reason = 'reservation_expired',
      updated_at = now()
  where workspace_id = p_workspace_id
    and status = 'reserved'
    and expires_at <= now();

  select * into v_existing
  from private.ai_generation_credit_reservations
  where workspace_id = p_workspace_id
    and operation_id = p_operation_id
  for update;

  if found then
    if v_existing.actor_user_id is not null and v_existing.actor_user_id <> v_actor then
      raise exception 'AI operation belongs to another user' using errcode = '42501';
    end if;
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key reused with different AI operation input'
        using errcode = '22023';
    end if;
    if v_existing.status = 'consumed' then
      return jsonb_build_object('allowed', false, 'duplicate', true, 'reason', 'already_consumed');
    end if;
    if v_existing.status = 'reserved' and v_existing.expires_at > now() then
      return jsonb_build_object('allowed', false, 'duplicate', true, 'reason', 'operation_in_progress');
    end if;
  end if;

  select
    case when pending_plan_key is not null and pending_plan_effective_at <= now()
      then pending_plan_key else plan_key end,
    status,
    custom_ai_credit_limit
  into v_plan, v_status, v_custom_ai
  from public.workspace_subscriptions
  where workspace_id = p_workspace_id
  for update;

  v_plan := coalesce(v_plan, 'free');
  v_status := coalesce(v_status, 'active');
  if v_status not in ('active', 'trialing') or exists (
    select 1 from public.workspace_subscriptions
    where workspace_id = p_workspace_id and current_period_end <= now()
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'subscription_inactive', 'plan', v_plan);
  end if;

  v_limit := case v_plan
    when 'starter' then 500
    when 'pro' then 2500
    when 'business' then 15000
    when 'enterprise' then v_custom_ai
    else 25
  end;
  if v_limit is null then
    return jsonb_build_object('allowed', false, 'reason', 'enterprise_limits_not_configured', 'plan', v_plan);
  end if;

  select coalesce(sum(quantity), 0) into v_ai
  from public.workspace_usage
  where workspace_id = p_workspace_id
    and period_start = v_period
    and metric = 'ai_credit';

  select coalesce(sum(quantity), 0) into v_generations
  from public.workspace_usage
  where workspace_id = p_workspace_id
    and period_start = v_period
    and metric = 'ai_generation';

  select count(*) into v_reserved
  from private.ai_generation_credit_reservations
  where workspace_id = p_workspace_id
    and period_start = v_period
    and status = 'reserved'
    and expires_at > now();

  if v_ai + v_reserved + 1 > v_limit or v_generations + v_reserved + 1 > v_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'limit_reached',
      'ai_credits_used', v_ai,
      'ai_credits_reserved', v_reserved,
      'generations_used', v_generations,
      'limit', v_limit,
      'plan', v_plan
    );
  end if;

  insert into private.ai_generation_credit_reservations(
    workspace_id, operation_id, request_fingerprint, status, period_start,
    actor_user_id, retry_count, expires_at, created_at, updated_at,
    consumed_at, released_at, release_reason
  )
  values (
    p_workspace_id, p_operation_id, p_request_fingerprint, 'reserved', v_period,
    v_actor, case when v_existing.operation_id is null then 0 else v_existing.retry_count + 1 end,
    now() + interval '10 minutes', now(), now(), null, null, null
  )
  on conflict (workspace_id, operation_id) do update
  set status = 'reserved',
      period_start = excluded.period_start,
      actor_user_id = excluded.actor_user_id,
      retry_count = excluded.retry_count,
      expires_at = excluded.expires_at,
      updated_at = now(),
      consumed_at = null,
      released_at = null,
      release_reason = null;

  return jsonb_build_object(
    'allowed', true,
    'duplicate', false,
    'operation_id', p_operation_id,
    'status', 'reserved',
    'expires_at', now() + interval '10 minutes',
    'ai_credits_used', v_ai,
    'ai_credits_reserved', v_reserved + 1,
    'generations_used', v_generations,
    'limit', v_limit,
    'plan', v_plan
  );
end;
$$;

revoke all on function public.reserve_ai_generation_usage(uuid, uuid, text) from public, anon;
grant execute on function public.reserve_ai_generation_usage(uuid, uuid, text) to authenticated;

-- Internal writer used by both settlement and release. Provider tokens/cost
-- are recorded for successful outputs and for provider usage generated before
-- an invalid output/failed operation is released.
create or replace function private.record_ai_provider_usage_events(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_provider_usage jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_provider text;
  v_model text;
  v_input bigint;
  v_output bigint;
  v_total bigint;
  v_cost numeric(18,12);
  v_fallback boolean;
  v_count integer := 0;
begin
  if p_provider_usage is null or jsonb_typeof(p_provider_usage) <> 'array' then
    raise exception 'invalid provider usage telemetry' using errcode = '22023';
  end if;
  if jsonb_array_length(p_provider_usage) > 16 then
    raise exception 'too many provider usage records' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_provider_usage)
  loop
    v_provider := v_item ->> 'provider';
    v_model := v_item ->> 'model';
    if v_provider is null or v_provider not in ('gemini', 'groq', 'cloudflare')
       or v_model is null or length(v_model) not between 1 and 128
       or coalesce(v_item ->> 'inputTokens', '') !~ '^[0-9]{1,18}$'
       or coalesce(v_item ->> 'outputTokens', '') !~ '^[0-9]{1,18}$'
       or coalesce(v_item ->> 'totalTokens', '') !~ '^[0-9]{1,18}$'
       or (v_item ? 'providerCostUsd' and
           coalesce(v_item ->> 'providerCostUsd', '') !~ '^[0-9]{1,6}(\.[0-9]{1,12})?$')
       or (v_item ? 'fallbackUsed' and jsonb_typeof(v_item -> 'fallbackUsed') <> 'boolean') then
      raise exception 'invalid provider usage telemetry' using errcode = '22023';
    end if;

    v_input := (v_item ->> 'inputTokens')::bigint;
    v_output := (v_item ->> 'outputTokens')::bigint;
    v_total := (v_item ->> 'totalTokens')::bigint;
    v_cost := case when v_item ? 'providerCostUsd'
      then (v_item ->> 'providerCostUsd')::numeric else null end;
    v_fallback := coalesce((v_item ->> 'fallbackUsed')::boolean, false);

    insert into private.ai_provider_usage_events(
      workspace_id, operation_id, provider, model, input_tokens, output_tokens,
      total_tokens, provider_cost_usd, fallback_used
    ) values (
      p_workspace_id, p_operation_id, v_provider, v_model, v_input, v_output,
      v_total, v_cost, v_fallback
    )
    on conflict (workspace_id, operation_id, provider, model) do update
    set input_tokens = private.ai_provider_usage_events.input_tokens + excluded.input_tokens,
        output_tokens = private.ai_provider_usage_events.output_tokens + excluded.output_tokens,
        total_tokens = private.ai_provider_usage_events.total_tokens + excluded.total_tokens,
        provider_cost_usd = case
          when private.ai_provider_usage_events.provider_cost_usd is null and excluded.provider_cost_usd is null then null
          else coalesce(private.ai_provider_usage_events.provider_cost_usd, 0) + coalesce(excluded.provider_cost_usd, 0)
        end,
        fallback_used = private.ai_provider_usage_events.fallback_used or excluded.fallback_used;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.record_ai_provider_usage_events(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- Release is idempotent and only changes an unconsumed hold. A release after a
-- successful consume is a no-op; a repeated release is also a no-op.
create or replace function public.release_ai_generation_usage(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_release_reason text default 'request_failed',
  p_provider_usage jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reservation private.ai_generation_credit_reservations%rowtype;
  v_provider_count integer := 0;
  v_reason text := coalesce(nullif(p_release_reason, ''), 'request_failed');
begin
  if v_actor is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_operation_id is null
     or length(v_reason) > 80 or v_reason !~ '^[a-zA-Z0-9_.-]{1,80}$'
     or p_provider_usage is null or jsonb_typeof(p_provider_usage) <> 'array' then
    raise exception 'invalid AI generation release request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text, 0)
  );

  select * into v_reservation
  from private.ai_generation_credit_reservations
  where workspace_id = p_workspace_id and operation_id = p_operation_id
  for update;

  if not found then
    return jsonb_build_object('released', false, 'duplicate', true, 'reason', 'reservation_not_found');
  end if;
  if v_reservation.actor_user_id is not null and v_reservation.actor_user_id <> v_actor then
    raise exception 'AI operation belongs to another user' using errcode = '42501';
  end if;
  if v_reservation.status = 'consumed' then
    return jsonb_build_object('released', false, 'duplicate', true, 'reason', 'already_consumed');
  end if;
  if v_reservation.status = 'released' then
    return jsonb_build_object('released', true, 'duplicate', true, 'reason', 'already_released');
  end if;

  v_provider_count := private.record_ai_provider_usage_events(
    p_workspace_id, p_operation_id, p_provider_usage
  );

  update private.ai_generation_credit_reservations
  set status = 'released',
      released_at = now(),
      release_reason = v_reason,
      updated_at = now()
  where workspace_id = p_workspace_id and operation_id = p_operation_id
    and status = 'reserved';

  return jsonb_build_object(
    'released', true, 'duplicate', false, 'reason', v_reason,
    'provider_usage_records', v_provider_count
  );
end;
$$;

revoke all on function public.release_ai_generation_usage(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.release_ai_generation_usage(uuid, uuid, text, jsonb) to authenticated;

-- Finalize the hold only after the application has validated the entire
-- registered workflow graph. Customer usage and provider usage are committed
-- together; retries against another provider do not create extra billing rows.
drop function if exists public.consume_ai_generation_usage(uuid, text);
create function public.consume_ai_generation_usage(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_provider_usage jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation private.ai_generation_credit_reservations%rowtype;
  v_plan text := 'free';
  v_status text := 'active';
  v_custom_ai integer;
  v_limit integer;
  v_ai bigint := 0;
  v_generations bigint := 0;
  v_reserved bigint := 0;
  v_period date := date_trunc('month', now())::date;
  v_actor uuid := auth.uid();
  v_provider_count integer := 0;
begin
  if v_actor is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_operation_id is null
     or p_provider_usage is null or jsonb_typeof(p_provider_usage) <> 'array'
     or jsonb_array_length(p_provider_usage) > 16 then
    raise exception 'invalid AI generation settlement' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text, 0)
  );

  select * into v_reservation
  from private.ai_generation_credit_reservations
  where workspace_id = p_workspace_id and operation_id = p_operation_id
  for update;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'reservation_not_found');
  end if;
  if v_reservation.actor_user_id is not null and v_reservation.actor_user_id <> v_actor then
    raise exception 'AI operation belongs to another user' using errcode = '42501';
  end if;
  if v_reservation.status = 'consumed' then
    return jsonb_build_object('allowed', true, 'duplicate', true, 'operation_id', p_operation_id);
  end if;
  if v_reservation.status <> 'reserved' or v_reservation.expires_at <= now() then
    return jsonb_build_object('allowed', false, 'reason', 'reservation_not_active');
  end if;

  -- Keep settlement in the quota period that authorized the hold, even if a
  -- request happens to finish across a month boundary.
  v_period := v_reservation.period_start;

  select
    case when pending_plan_key is not null and pending_plan_effective_at <= now()
      then pending_plan_key else plan_key end,
    status,
    custom_ai_credit_limit
  into v_plan, v_status, v_custom_ai
  from public.workspace_subscriptions
  where workspace_id = p_workspace_id
  for update;

  v_plan := coalesce(v_plan, 'free');
  v_status := coalesce(v_status, 'active');
  if v_status not in ('active', 'trialing') or exists (
    select 1 from public.workspace_subscriptions
    where workspace_id = p_workspace_id and current_period_end <= now()
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'subscription_inactive', 'plan', v_plan);
  end if;

  v_limit := case v_plan
    when 'starter' then 500
    when 'pro' then 2500
    when 'business' then 15000
    when 'enterprise' then v_custom_ai
    else 25
  end;
  if v_limit is null then
    return jsonb_build_object('allowed', false, 'reason', 'enterprise_limits_not_configured', 'plan', v_plan);
  end if;

  select coalesce(sum(quantity), 0) into v_ai
  from public.workspace_usage
  where workspace_id = p_workspace_id and period_start = v_period and metric = 'ai_credit';

  select coalesce(sum(quantity), 0) into v_generations
  from public.workspace_usage
  where workspace_id = p_workspace_id and period_start = v_period and metric = 'ai_generation';

  select count(*) into v_reserved
  from private.ai_generation_credit_reservations
  where workspace_id = p_workspace_id and period_start = v_period
    and status = 'reserved' and expires_at > now();

  -- This reservation is already included in v_reserved. Settlement swaps one
  -- held unit for one consumed unit, so the projected usage is v_used + holds.
  if v_ai + v_reserved > v_limit or v_generations + v_reserved > v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit_reached', 'plan', v_plan);
  end if;

  insert into public.workspace_usage(
    workspace_id, metric, quantity, period_start, actor_user_id, metadata
  ) values
    (p_workspace_id, 'ai_generation', 1, v_period, v_actor,
      jsonb_build_object('feature', 'workflow_draft_generation', 'idempotency_key', p_operation_id::text, 'operation_id', p_operation_id)),
    (p_workspace_id, 'ai_credit', 1, v_period, v_actor,
      jsonb_build_object('feature', 'workflow_draft_generation', 'idempotency_key', p_operation_id::text, 'operation_id', p_operation_id));

  v_provider_count := private.record_ai_provider_usage_events(
    p_workspace_id, p_operation_id, p_provider_usage
  );

  update private.ai_generation_credit_reservations
  set status = 'consumed',
      consumed_at = now(),
      updated_at = now(),
      expires_at = now()
  where workspace_id = p_workspace_id and operation_id = p_operation_id;

  return jsonb_build_object(
    'allowed', true,
    'duplicate', false,
    'operation_id', p_operation_id,
    'ai_credits_used', v_ai + 1,
    'generations_used', v_generations + 1,
    'provider_usage_records', v_provider_count,
    'limit', v_limit,
    'plan', v_plan
  );
end;
$$;

revoke all on function public.consume_ai_generation_usage(uuid, uuid, jsonb) from public, anon;
grant execute on function public.consume_ai_generation_usage(uuid, uuid, jsonb) to authenticated;

-- Other customer-initiated metering must treat outstanding AI generation holds
-- as occupied quota too; a held generation cannot be spent by an agent or a
-- parallel generic usage operation before it settles.
create or replace function public.consume_workspace_usage(
  p_workspace_id uuid,
  p_metric text,
  p_quantity integer default 1,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text := 'free';
  v_status text := 'active';
  v_period date := date_trunc('month', now())::date;
  v_used bigint := 0;
  v_limit bigint;
  v_actor uuid := auth.uid();
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_key text := nullif(v_metadata ->> 'idempotency_key', '');
  v_custom_workflows integer;
  v_custom_executions integer;
  v_custom_ai integer;
  v_reserved bigint := 0;
begin
  if v_actor is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_metric not in ('workflow_created','workflow_execution','ai_credit','agent_run','ai_generation')
     or p_quantity is null or p_quantity < 1 or p_quantity > 100
     or jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'invalid usage request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text, 0));
  if v_key is not null and exists (
    select 1 from public.workspace_usage
    where workspace_id = p_workspace_id and metric = p_metric and metadata ->> 'idempotency_key' = v_key
  ) then
    select coalesce(sum(quantity), 0) into v_used
    from public.workspace_usage
    where workspace_id = p_workspace_id and period_start = v_period and metric = p_metric;
    return jsonb_build_object('allowed', true, 'duplicate', true, 'metric', p_metric, 'used', v_used);
  end if;

  select
    case when pending_plan_key is not null and pending_plan_effective_at <= now()
      then pending_plan_key else plan_key end,
    status, custom_workflow_limit, custom_execution_limit, custom_ai_credit_limit
  into v_plan, v_status, v_custom_workflows, v_custom_executions, v_custom_ai
  from public.workspace_subscriptions
  where workspace_id = p_workspace_id
  for update;

  v_plan := coalesce(v_plan, 'free');
  v_status := coalesce(v_status, 'active');
  if v_status not in ('active','trialing') or exists (
    select 1 from public.workspace_subscriptions
    where workspace_id = p_workspace_id and current_period_end <= now()
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'subscription_inactive', 'plan', v_plan);
  end if;

  v_limit := case v_plan
    when 'starter' then case p_metric when 'workflow_created' then 10 when 'workflow_execution' then 2000 when 'ai_credit' then 500 else 500 end
    when 'pro' then case p_metric when 'workflow_created' then 50 when 'workflow_execution' then 10000 when 'ai_credit' then 2500 else 2500 end
    when 'business' then case p_metric when 'workflow_created' then 200 when 'workflow_execution' then 50000 when 'ai_credit' then 15000 else 15000 end
    when 'enterprise' then case p_metric when 'workflow_created' then v_custom_workflows when 'workflow_execution' then v_custom_executions else v_custom_ai end
    else case p_metric when 'workflow_created' then 2 when 'workflow_execution' then 300 when 'ai_credit' then 25 else 25 end
  end;
  if v_limit is null then
    return jsonb_build_object('allowed', false, 'reason', 'enterprise_limits_not_configured', 'plan', v_plan);
  end if;

  if p_metric = 'workflow_created' then
    select count(*) into v_used from public.workflows
    where workspace_id = p_workspace_id and status = 'active';
  else
    select coalesce(sum(quantity), 0) into v_used
    from public.workspace_usage
    where workspace_id = p_workspace_id and period_start = v_period and metric = p_metric;
  end if;

  if p_metric in ('ai_credit', 'ai_generation') then
    select count(*) into v_reserved
    from private.ai_generation_credit_reservations
    where workspace_id = p_workspace_id and period_start = v_period
      and status = 'reserved' and expires_at > now();
  end if;

  if v_used + p_quantity + v_reserved > v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit_reached',
      'metric', p_metric, 'used', v_used, 'reserved', v_reserved, 'limit', v_limit, 'plan', v_plan);
  end if;

  insert into public.workspace_usage(workspace_id, metric, quantity, period_start, actor_user_id, metadata)
  values (p_workspace_id, p_metric, p_quantity, v_period, v_actor, v_metadata);
  return jsonb_build_object('allowed', true, 'duplicate', false, 'metric', p_metric,
    'used', v_used + p_quantity, 'reserved', v_reserved, 'limit', v_limit, 'plan', v_plan);
end;
$$;

revoke all on function public.consume_workspace_usage(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.consume_workspace_usage(uuid, text, integer, jsonb) to authenticated;

create or replace function public.consume_agent_run_usage(
  p_workspace_id uuid,
  p_agent_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text := 'free';
  v_status text := 'active';
  v_custom_ai integer;
  v_limit integer;
  v_agents bigint := 0;
  v_credits bigint := 0;
  v_reserved bigint := 0;
  v_period date := date_trunc('month', now())::date;
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_agent_id is null or p_idempotency_key is null
     or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 128 then
    raise exception 'invalid agent usage request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text, 0));
  if exists (
    select 1 from public.workspace_usage
    where workspace_id = p_workspace_id and metric = 'agent_run'
      and metadata ->> 'idempotency_key' = p_idempotency_key
  ) then
    return jsonb_build_object('allowed', true, 'duplicate', true);
  end if;

  select
    case when pending_plan_key is not null and pending_plan_effective_at <= now()
      then pending_plan_key else plan_key end,
    status, custom_ai_credit_limit
  into v_plan, v_status, v_custom_ai
  from public.workspace_subscriptions
  where workspace_id = p_workspace_id
  for update;

  v_plan := coalesce(v_plan, 'free');
  v_status := coalesce(v_status, 'active');
  if v_status not in ('active', 'trialing') or exists (
    select 1 from public.workspace_subscriptions
    where workspace_id = p_workspace_id and current_period_end <= now()
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'subscription_inactive');
  end if;

  v_limit := case v_plan when 'starter' then 500 when 'pro' then 2500
    when 'business' then 15000 when 'enterprise' then v_custom_ai else 25 end;
  if v_limit is null then
    return jsonb_build_object('allowed', false, 'reason', 'enterprise_limits_not_configured');
  end if;

  select coalesce(sum(quantity), 0) into v_agents
  from public.workspace_usage
  where workspace_id = p_workspace_id and period_start = v_period and metric = 'agent_run';

  select coalesce(sum(quantity), 0) into v_credits
  from public.workspace_usage
  where workspace_id = p_workspace_id and period_start = v_period and metric = 'ai_credit';

  select count(*) into v_reserved
  from private.ai_generation_credit_reservations
  where workspace_id = p_workspace_id and period_start = v_period
    and status = 'reserved' and expires_at > now();

  if v_agents + 1 > v_limit or v_credits + v_reserved + 1 > v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit_reached',
      'agent_runs_used', v_agents, 'ai_credits_used', v_credits,
      'ai_credits_reserved', v_reserved, 'limit', v_limit, 'plan', v_plan);
  end if;

  insert into public.workspace_usage(workspace_id, metric, quantity, period_start, actor_user_id, metadata)
  values
    (p_workspace_id, 'agent_run', 1, v_period, v_actor,
      jsonb_build_object('feature', 'agent_run', 'agent_id', p_agent_id, 'idempotency_key', p_idempotency_key)),
    (p_workspace_id, 'ai_credit', 1, v_period, v_actor,
      jsonb_build_object('feature', 'agent_run', 'agent_id', p_agent_id, 'idempotency_key', p_idempotency_key));

  return jsonb_build_object('allowed', true, 'duplicate', false,
    'agent_runs_used', v_agents + 1, 'ai_credits_used', v_credits + 1,
    'ai_credits_reserved', v_reserved, 'limit', v_limit, 'plan', v_plan);
end;
$$;

revoke all on function public.consume_agent_run_usage(uuid, uuid, text) from public, anon;
grant execute on function public.consume_agent_run_usage(uuid, uuid, text) to authenticated;

-- Report holds separately from consumed usage for the authenticated workspace
-- owner/admin interface. The usage and limit values remain the consumed counts.
create or replace function public.get_workspace_entitlements(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text := 'free';
  v_status text := 'active';
  v_start date := date_trunc('month', now())::date;
  v_workflows bigint := 0;
  v_exec bigint := 0;
  v_ai bigint := 0;
  v_agents bigint := 0;
  v_generations bigint := 0;
  v_reserved bigint := 0;
  v_workflow_limit integer := 2;
  v_execution_limit integer := 300;
  v_ai_limit integer := 25;
begin
  if auth.uid() is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;

  select
    case when pending_plan_key is not null and pending_plan_effective_at <= now()
      then pending_plan_key else plan_key end,
    status, custom_workflow_limit, custom_execution_limit, custom_ai_credit_limit
  into v_plan, v_status, v_workflow_limit, v_execution_limit, v_ai_limit
  from public.workspace_subscriptions
  where workspace_id = p_workspace_id;

  v_plan := coalesce(v_plan, 'free');
  v_status := coalesce(v_status, 'active');
  v_start := date_trunc('month', now())::date;
  if exists (select 1 from public.workspace_subscriptions where workspace_id = p_workspace_id and current_period_end <= now()) then
    v_status := 'expired';
  end if;
  if v_plan <> 'enterprise' then
    v_workflow_limit := case v_plan when 'starter' then 10 when 'pro' then 50 when 'business' then 200 else 2 end;
    v_execution_limit := case v_plan when 'starter' then 2000 when 'pro' then 10000 when 'business' then 50000 else 300 end;
    v_ai_limit := case v_plan when 'starter' then 500 when 'pro' then 2500 when 'business' then 15000 else 25 end;
  end if;

  select count(*) into v_workflows from public.workflows
  where workspace_id = p_workspace_id and status = 'active';

  select
    coalesce(sum(quantity) filter (where metric = 'workflow_execution'), 0),
    coalesce(sum(quantity) filter (where metric = 'ai_credit'), 0),
    coalesce(sum(quantity) filter (where metric = 'agent_run'), 0),
    coalesce(sum(quantity) filter (where metric = 'ai_generation'), 0)
  into v_exec, v_ai, v_agents, v_generations
  from public.workspace_usage
  where workspace_id = p_workspace_id and period_start = v_start;

  select count(*) into v_reserved
  from private.ai_generation_credit_reservations
  where workspace_id = p_workspace_id and period_start = v_start
    and status = 'reserved' and expires_at > now();

  return jsonb_build_object(
    'plan', v_plan,
    'status', v_status,
    'period_start', v_start,
    'usage', jsonb_build_object('workflow_created', v_workflows, 'workflow_execution', v_exec,
      'ai_credit', v_ai, 'agent_run', v_agents, 'ai_generation', v_generations),
    'reserved', jsonb_build_object('ai_credit', v_reserved, 'ai_generation', v_reserved),
    'limits', jsonb_build_object('workflow_created', v_workflow_limit,
      'workflow_execution', v_execution_limit, 'ai_credit', v_ai_limit,
      'agent_run', v_ai_limit, 'ai_generation', v_ai_limit),
    'billing', jsonb_build_object(
      'provider_connected', exists(select 1 from public.workspace_subscriptions where workspace_id = p_workspace_id and billing_provider is not null),
      'checkout_enabled', false
    )
  );
end;
$$;

revoke all on function public.get_workspace_entitlements(uuid) from public, anon;
grant execute on function public.get_workspace_entitlements(uuid) to authenticated;
