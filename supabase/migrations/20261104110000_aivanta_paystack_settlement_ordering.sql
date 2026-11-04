-- Prevent delayed Paystack callbacks from replacing a newer workspace entitlement.
-- Additive function replacement; preserves service-role-only execution.
create or replace function public.process_paystack_payment(
  p_reference text,
  p_event_key text,
  p_event_type text,
  p_transaction_id bigint,
  p_paid_at timestamptz
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payment public.billing_payments%rowtype;
  v_paid_at timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if p_reference is null or length(p_reference) > 128
     or p_event_key is null or length(p_event_key) > 255
     or p_event_type is null or length(p_event_type) > 80
     or p_transaction_id is null or p_transaction_id <= 0 then
    raise exception 'Invalid Paystack settlement input' using errcode = '22023';
  end if;

  select * into v_payment
  from public.billing_payments
  where reference = p_reference
  for update;

  if not found then
    raise exception 'Payment reference not found' using errcode = 'P0002';
  end if;

  if v_payment.status = 'refunded' then
    raise exception 'Refunded payment cannot grant an entitlement' using errcode = '23514';
  end if;

  v_paid_at := coalesce(v_payment.paid_at, p_paid_at, pg_catalog.now());

  insert into public.billing_webhook_events (event_key, event_type, reference)
  values (p_event_key, p_event_type, p_reference)
  on conflict (event_key) do nothing;

  update public.billing_payments
  set status = 'success',
      provider_transaction_id = p_transaction_id,
      paid_at = v_paid_at,
      updated_at = pg_catalog.now()
  where id = v_payment.id;

  -- Replays of this payment retain their original period. A later-paid payment
  -- may advance the entitlement, but an older delayed callback may not roll it back.
  select current_period_start, current_period_end
    into v_period_start, v_period_end
  from public.workspace_subscriptions
  where workspace_id = v_payment.workspace_id
    and last_payment_id = v_payment.id
  for update;

  if not found then
    v_period_start := v_paid_at;
    v_period_end := v_paid_at + interval '30 days';
  end if;

  insert into public.workspace_subscriptions (
    workspace_id, provider, plan_slug, status, currency, amount_minor,
    current_period_start, current_period_end, last_payment_id, updated_at
  ) values (
    v_payment.workspace_id, 'paystack', v_payment.plan_slug, 'active',
    v_payment.currency, v_payment.amount_minor,
    v_period_start, v_period_end, v_payment.id, pg_catalog.now()
  )
  on conflict (workspace_id) do update set
    provider = excluded.provider,
    plan_slug = excluded.plan_slug,
    status = 'active',
    currency = excluded.currency,
    amount_minor = excluded.amount_minor,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    last_payment_id = excluded.last_payment_id,
    updated_at = pg_catalog.now()
  where public.workspace_subscriptions.last_payment_id = excluded.last_payment_id
     or public.workspace_subscriptions.current_period_start <= excluded.current_period_start;

  update public.billing_webhook_events
  set processed_at = coalesce(processed_at, pg_catalog.now())
  where event_key = p_event_key;

  return 'processed';
end;
$$;

revoke all on function public.process_paystack_payment(text, text, text, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_paystack_payment(text, text, text, bigint, timestamptz)
  to service_role;

comment on function public.process_paystack_payment(text, text, text, bigint, timestamptz)
  is 'Atomically records verified Paystack payments and 30-day entitlements; stale callbacks cannot overwrite a newer workspace subscription. Service-role only.';
