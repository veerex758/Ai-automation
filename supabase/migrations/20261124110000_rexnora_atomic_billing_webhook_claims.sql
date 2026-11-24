-- Atomic claims for Stripe and Paystack webhook delivery.
-- A single guarded UPDATE owns an event for the lease window; simultaneous
-- deliveries serialize on the ledger row and only one receives a claim token.

alter table public.billing_recurring_events
  add column if not exists claim_token uuid,
  add column if not exists claim_expires_at timestamptz;

alter table public.billing_webhook_events
  add column if not exists payload_hash text,
  add column if not exists claim_token uuid,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists processing_error text;

create index if not exists billing_recurring_events_claim_expiry_idx
  on public.billing_recurring_events(claim_expires_at)
  where processed_at is null;

create index if not exists billing_webhook_events_claim_expiry_idx
  on public.billing_webhook_events(claim_expires_at)
  where processed_at is null;

create or replace function public.claim_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_event_type text,
  p_payload_hash text,
  p_reference text default null,
  p_workspace_id uuid default null,
  p_lease_seconds integer default 900
)
returns table(claimed boolean, claim_token uuid, reason text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token uuid;
  v_reason text;
  v_now timestamptz := pg_catalog.now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack')
     or p_event_key is null or length(p_event_key) not between 1 and 255
     or p_event_type is null or length(p_event_type) not between 1 and 120
     or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$'
     or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid webhook claim' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    insert into public.billing_recurring_events(
      provider,event_key,event_type,workspace_id,payload_hash
    ) values (
      p_provider,p_event_key,p_event_type,p_workspace_id,p_payload_hash
    ) on conflict (event_key) do nothing;

    update public.billing_recurring_events e
       set payload_hash = case when e.payload_hash ~ '^[a-f0-9]{64}$' then e.payload_hash else p_payload_hash end,
           claim_token = pg_catalog.gen_random_uuid(),
           claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
           processing_error = null
     where e.event_key = p_event_key
       and e.provider = p_provider
       and e.event_type = p_event_type
       and (e.payload_hash = p_payload_hash or e.payload_hash !~ '^[a-f0-9]{64}$')
       and e.processed_at is null
       and (e.claim_token is null or e.claim_expires_at is null or e.claim_expires_at <= v_now)
    returning e.claim_token into v_token;

    if v_token is not null then
      v_reason := 'claimed';
    else
      select case
        when e.provider <> p_provider or e.event_type <> p_event_type then 'event_key_conflict'
        when e.payload_hash ~ '^[a-f0-9]{64}$' and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      end into v_reason
      from public.billing_recurring_events e
      where e.event_key = p_event_key;
    end if;
  else
    insert into public.billing_webhook_events(
      provider,event_key,event_type,reference,payload_hash
    ) values (
      'paystack',p_event_key,p_event_type,p_reference,p_payload_hash
    ) on conflict (event_key) do nothing;

    update public.billing_webhook_events e
       set payload_hash = coalesce(e.payload_hash,p_payload_hash),
           claim_token = pg_catalog.gen_random_uuid(),
           claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
           processing_error = null
     where e.event_key = p_event_key
       and e.provider = 'paystack'
       and e.event_type = p_event_type
       and e.reference is not distinct from p_reference
       and (e.payload_hash is null or e.payload_hash = p_payload_hash)
       and e.processed_at is null
       and (e.claim_token is null or e.claim_expires_at is null or e.claim_expires_at <= v_now)
    returning e.claim_token into v_token;

    if v_token is not null then
      v_reason := 'claimed';
    else
      select case
        when e.provider <> 'paystack' or e.event_type <> p_event_type
          or e.reference is distinct from p_reference then 'event_key_conflict'
        when e.payload_hash is not null and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_webhook_events e
      where e.event_key = p_event_key;
    end if;
  end if;

  return query select (v_token is not null), v_token, coalesce(v_reason,'not_found');
end;
$$;

create or replace function public.complete_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook completion' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

create or replace function public.release_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid,
  p_error_code text default 'PROCESSING_FAILED'
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error_code text := case when p_error_code ~ '^[A-Z0-9_]{1,80}$'
    then p_error_code else 'PROCESSING_FAILED' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook release' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

revoke all on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.complete_billing_webhook_event(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.release_billing_webhook_event(text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  to service_role;
grant execute on function public.complete_billing_webhook_event(text,text,uuid)
  to service_role;
grant execute on function public.release_billing_webhook_event(text,text,uuid,text)
  to service_role;
 and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_recurring_events e
      where e.event_key = p_event_key;
    end if;
  else
    insert into public.billing_webhook_events(
      provider,event_key,event_type,reference,payload_hash
    ) values (
      'paystack',p_event_key,p_event_type,p_reference,p_payload_hash
    ) on conflict (event_key) do nothing;

    update public.billing_webhook_events e
       set payload_hash = coalesce(e.payload_hash,p_payload_hash),
           claim_token = pg_catalog.gen_random_uuid(),
           claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
           processing_error = null
     where e.event_key = p_event_key
       and e.provider = 'paystack'
       and e.event_type = p_event_type
       and e.reference is not distinct from p_reference
       and (e.payload_hash is null or e.payload_hash = p_payload_hash)
       and e.processed_at is null
       and (e.claim_token is null or e.claim_expires_at is null or e.claim_expires_at <= v_now)
    returning e.claim_token into v_token;

    if v_token is not null then
      v_reason := 'claimed';
    else
      select case
        when e.provider <> 'paystack' or e.event_type <> p_event_type
          or e.reference is distinct from p_reference then 'event_key_conflict'
        when e.payload_hash is not null and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_webhook_events e
      where e.event_key = p_event_key;
    end if;
  end if;

  return query select (v_token is not null), v_token, coalesce(v_reason,'not_found');
end;
$$;

create or replace function public.complete_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook completion' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

create or replace function public.release_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid,
  p_error_code text default 'PROCESSING_FAILED'
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error_code text := case when p_error_code ~ '^[A-Z0-9_]{1,80}$'
    then p_error_code else 'PROCESSING_FAILED' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook release' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

revoke all on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.complete_billing_webhook_event(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.release_billing_webhook_event(text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  to service_role;
grant execute on function public.complete_billing_webhook_event(text,text,uuid)
  to service_role;
grant execute on function public.release_billing_webhook_event(text,text,uuid,text)
  to service_role;
 and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_recurring_events e
      where e.event_key = p_event_key;
    end if;
  else
    insert into public.billing_webhook_events(
      provider,event_key,event_type,reference,payload_hash
    ) values (
      'paystack',p_event_key,p_event_type,p_reference,p_payload_hash
    ) on conflict (event_key) do nothing;

    update public.billing_webhook_events e
       set payload_hash = coalesce(e.payload_hash,p_payload_hash),
           claim_token = pg_catalog.gen_random_uuid(),
           claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
           processing_error = null
     where e.event_key = p_event_key
       and e.provider = 'paystack'
       and e.event_type = p_event_type
       and e.reference is not distinct from p_reference
       and (e.payload_hash is null or e.payload_hash = p_payload_hash)
       and e.processed_at is null
       and (e.claim_token is null or e.claim_expires_at is null or e.claim_expires_at <= v_now)
    returning e.claim_token into v_token;

    if v_token is not null then
      v_reason := 'claimed';
    else
      select case
        when e.provider <> 'paystack' or e.event_type <> p_event_type
          or e.reference is distinct from p_reference then 'event_key_conflict'
        when e.payload_hash is not null and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_webhook_events e
      where e.event_key = p_event_key;
    end if;
  end if;

  return query select (v_token is not null), v_token, coalesce(v_reason,'not_found');
end;
$$;

create or replace function public.complete_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook completion' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

create or replace function public.release_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid,
  p_error_code text default 'PROCESSING_FAILED'
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error_code text := case when p_error_code ~ '^[A-Z0-9_]{1,80}$'
    then p_error_code else 'PROCESSING_FAILED' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook release' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

revoke all on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.complete_billing_webhook_event(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.release_billing_webhook_event(text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  to service_role;
grant execute on function public.complete_billing_webhook_event(text,text,uuid)
  to service_role;
grant execute on function public.release_billing_webhook_event(text,text,uuid,text)
  to service_role;
 and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_recurring_events e
      where e.event_key = p_event_key;
    end if;
  else
    insert into public.billing_webhook_events(
      provider,event_key,event_type,reference,payload_hash
    ) values (
      'paystack',p_event_key,p_event_type,p_reference,p_payload_hash
    ) on conflict (event_key) do nothing;

    update public.billing_webhook_events e
       set payload_hash = coalesce(e.payload_hash,p_payload_hash),
           claim_token = pg_catalog.gen_random_uuid(),
           claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
           processing_error = null
     where e.event_key = p_event_key
       and e.provider = 'paystack'
       and e.event_type = p_event_type
       and e.reference is not distinct from p_reference
       and (e.payload_hash is null or e.payload_hash = p_payload_hash)
       and e.processed_at is null
       and (e.claim_token is null or e.claim_expires_at is null or e.claim_expires_at <= v_now)
    returning e.claim_token into v_token;

    if v_token is not null then
      v_reason := 'claimed';
    else
      select case
        when e.provider <> 'paystack' or e.event_type <> p_event_type
          or e.reference is distinct from p_reference then 'event_key_conflict'
        when e.payload_hash is not null and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_webhook_events e
      where e.event_key = p_event_key;
    end if;
  end if;

  return query select (v_token is not null), v_token, coalesce(v_reason,'not_found');
end;
$$;

create or replace function public.complete_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook completion' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

create or replace function public.release_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid,
  p_error_code text default 'PROCESSING_FAILED'
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error_code text := case when p_error_code ~ '^[A-Z0-9_]{1,80}$'
    then p_error_code else 'PROCESSING_FAILED' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook release' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

revoke all on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.complete_billing_webhook_event(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.release_billing_webhook_event(text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  to service_role;
grant execute on function public.complete_billing_webhook_event(text,text,uuid)
  to service_role;
grant execute on function public.release_billing_webhook_event(text,text,uuid,text)
  to service_role;
 and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_recurring_events e
      where e.event_key = p_event_key;
    end if;
  else
    insert into public.billing_webhook_events(
      provider,event_key,event_type,reference,payload_hash
    ) values (
      'paystack',p_event_key,p_event_type,p_reference,p_payload_hash
    ) on conflict (event_key) do nothing;

    update public.billing_webhook_events e
       set payload_hash = coalesce(e.payload_hash,p_payload_hash),
           claim_token = pg_catalog.gen_random_uuid(),
           claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
           processing_error = null
     where e.event_key = p_event_key
       and e.provider = 'paystack'
       and e.event_type = p_event_type
       and e.reference is not distinct from p_reference
       and (e.payload_hash is null or e.payload_hash = p_payload_hash)
       and e.processed_at is null
       and (e.claim_token is null or e.claim_expires_at is null or e.claim_expires_at <= v_now)
    returning e.claim_token into v_token;

    if v_token is not null then
      v_reason := 'claimed';
    else
      select case
        when e.provider <> 'paystack' or e.event_type <> p_event_type
          or e.reference is distinct from p_reference then 'event_key_conflict'
        when e.payload_hash is not null and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_webhook_events e
      where e.event_key = p_event_key;
    end if;
  end if;

  return query select (v_token is not null), v_token, coalesce(v_reason,'not_found');
end;
$$;

create or replace function public.complete_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook completion' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

create or replace function public.release_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid,
  p_error_code text default 'PROCESSING_FAILED'
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error_code text := case when p_error_code ~ '^[A-Z0-9_]{1,80}$'
    then p_error_code else 'PROCESSING_FAILED' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook release' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

revoke all on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.complete_billing_webhook_event(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.release_billing_webhook_event(text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  to service_role;
grant execute on function public.complete_billing_webhook_event(text,text,uuid)
  to service_role;
grant execute on function public.release_billing_webhook_event(text,text,uuid,text)
  to service_role;
 and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_recurring_events e
      where e.event_key = p_event_key;
    end if;
  else
    insert into public.billing_webhook_events(
      provider,event_key,event_type,reference,payload_hash
    ) values (
      'paystack',p_event_key,p_event_type,p_reference,p_payload_hash
    ) on conflict (event_key) do nothing;

    update public.billing_webhook_events e
       set payload_hash = coalesce(e.payload_hash,p_payload_hash),
           claim_token = pg_catalog.gen_random_uuid(),
           claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
           processing_error = null
     where e.event_key = p_event_key
       and e.provider = 'paystack'
       and e.event_type = p_event_type
       and e.reference is not distinct from p_reference
       and (e.payload_hash is null or e.payload_hash = p_payload_hash)
       and e.processed_at is null
       and (e.claim_token is null or e.claim_expires_at is null or e.claim_expires_at <= v_now)
    returning e.claim_token into v_token;

    if v_token is not null then
      v_reason := 'claimed';
    else
      select case
        when e.provider <> 'paystack' or e.event_type <> p_event_type
          or e.reference is distinct from p_reference then 'event_key_conflict'
        when e.payload_hash is not null and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_webhook_events e
      where e.event_key = p_event_key;
    end if;
  end if;

  return query select (v_token is not null), v_token, coalesce(v_reason,'not_found');
end;
$$;

create or replace function public.complete_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook completion' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

create or replace function public.release_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid,
  p_error_code text default 'PROCESSING_FAILED'
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error_code text := case when p_error_code ~ '^[A-Z0-9_]{1,80}$'
    then p_error_code else 'PROCESSING_FAILED' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook release' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

revoke all on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.complete_billing_webhook_event(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.release_billing_webhook_event(text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  to service_role;
grant execute on function public.complete_billing_webhook_event(text,text,uuid)
  to service_role;
grant execute on function public.release_billing_webhook_event(text,text,uuid,text)
  to service_role;
 and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_recurring_events e
      where e.event_key = p_event_key;
    end if;
  else
    insert into public.billing_webhook_events(
      provider,event_key,event_type,reference,payload_hash
    ) values (
      'paystack',p_event_key,p_event_type,p_reference,p_payload_hash
    ) on conflict (event_key) do nothing;

    update public.billing_webhook_events e
       set payload_hash = coalesce(e.payload_hash,p_payload_hash),
           claim_token = pg_catalog.gen_random_uuid(),
           claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
           processing_error = null
     where e.event_key = p_event_key
       and e.provider = 'paystack'
       and e.event_type = p_event_type
       and e.reference is not distinct from p_reference
       and (e.payload_hash is null or e.payload_hash = p_payload_hash)
       and e.processed_at is null
       and (e.claim_token is null or e.claim_expires_at is null or e.claim_expires_at <= v_now)
    returning e.claim_token into v_token;

    if v_token is not null then
      v_reason := 'claimed';
    else
      select case
        when e.provider <> 'paystack' or e.event_type <> p_event_type
          or e.reference is distinct from p_reference then 'event_key_conflict'
        when e.payload_hash is not null and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_webhook_events e
      where e.event_key = p_event_key;
    end if;
  end if;

  return query select (v_token is not null), v_token, coalesce(v_reason,'not_found');
end;
$$;

create or replace function public.complete_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook completion' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

create or replace function public.release_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid,
  p_error_code text default 'PROCESSING_FAILED'
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error_code text := case when p_error_code ~ '^[A-Z0-9_]{1,80}$'
    then p_error_code else 'PROCESSING_FAILED' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook release' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

revoke all on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.complete_billing_webhook_event(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.release_billing_webhook_event(text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  to service_role;
grant execute on function public.complete_billing_webhook_event(text,text,uuid)
  to service_role;
grant execute on function public.release_billing_webhook_event(text,text,uuid,text)
  to service_role;
 and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_recurring_events e
      where e.event_key = p_event_key;
    end if;
  else
    insert into public.billing_webhook_events(
      provider,event_key,event_type,reference,payload_hash
    ) values (
      'paystack',p_event_key,p_event_type,p_reference,p_payload_hash
    ) on conflict (event_key) do nothing;

    update public.billing_webhook_events e
       set payload_hash = coalesce(e.payload_hash,p_payload_hash),
           claim_token = pg_catalog.gen_random_uuid(),
           claim_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
           processing_error = null
     where e.event_key = p_event_key
       and e.provider = 'paystack'
       and e.event_type = p_event_type
       and e.reference is not distinct from p_reference
       and (e.payload_hash is null or e.payload_hash = p_payload_hash)
       and e.processed_at is null
       and (e.claim_token is null or e.claim_expires_at is null or e.claim_expires_at <= v_now)
    returning e.claim_token into v_token;

    if v_token is not null then
      v_reason := 'claimed';
    else
      select case
        when e.provider <> 'paystack' or e.event_type <> p_event_type
          or e.reference is distinct from p_reference then 'event_key_conflict'
        when e.payload_hash is not null and e.payload_hash <> p_payload_hash then 'payload_mismatch'
        when e.processed_at is not null then 'completed'
        when e.claim_token is not null and e.claim_expires_at > v_now then 'in_progress'
        else 'unavailable'
      end into v_reason
      from public.billing_webhook_events e
      where e.event_key = p_event_key;
    end if;
  end if;

  return query select (v_token is not null), v_token, coalesce(v_reason,'not_found');
end;
$$;

create or replace function public.complete_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook completion' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set processed_at = pg_catalog.now(), claim_token = null, claim_expires_at = null,
           processing_error = null
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

create or replace function public.release_billing_webhook_event(
  p_provider text,
  p_event_key text,
  p_claim_token uuid,
  p_error_code text default 'PROCESSING_FAILED'
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error_code text := case when p_error_code ~ '^[A-Z0-9_]{1,80}$'
    then p_error_code else 'PROCESSING_FAILED' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_provider not in ('stripe','paystack') or p_event_key is null or p_claim_token is null then
    raise exception 'invalid webhook release' using errcode = '22023';
  end if;

  if p_provider = 'stripe' then
    update public.billing_recurring_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = p_provider
       and claim_token = p_claim_token and processed_at is null;
  else
    update public.billing_webhook_events
       set claim_token = null, claim_expires_at = null, processing_error = v_error_code
     where event_key = p_event_key and provider = 'paystack'
       and claim_token = p_claim_token and processed_at is null;
  end if;
  return found;
end;
$$;

revoke all on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.complete_billing_webhook_event(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.release_billing_webhook_event(text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_billing_webhook_event(text,text,text,text,text,uuid,integer)
  to service_role;
grant execute on function public.complete_billing_webhook_event(text,text,uuid)
  to service_role;
grant execute on function public.release_billing_webhook_event(text,text,uuid,text)
  to service_role;
