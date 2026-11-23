-- Self-service workspace subscription cancellation.
-- Current Paystack checkout is a prepaid period purchase (not a recurring mandate),
-- so cancellation prevents renewal and preserves access through the paid-through date.
create or replace function public.request_workspace_subscription_cancellation(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_subscription public.workspace_subscriptions%rowtype;
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null or p_workspace_id is null then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;

  select role into v_role
    from public.workspace_members
    where workspace_id = p_workspace_id and user_id = v_actor;
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'workspace billing administrator required' using errcode = '42501';
  end if;

  select * into v_subscription
    from public.workspace_subscriptions
    where workspace_id = p_workspace_id
    for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'subscription_not_found');
  end if;
  if v_subscription.plan_key = 'free' or v_subscription.status = 'canceled' then
    return jsonb_build_object('success', false, 'reason', 'no_active_paid_subscription');
  end if;
  if v_subscription.cancel_at_period_end then
    return jsonb_build_object(
      'success', true,
      'already_scheduled', true,
      'cancel_at_period_end', true,
      'current_period_end', v_subscription.current_period_end
    );
  end if;

  if v_subscription.current_period_end <= now() then
    update public.workspace_subscriptions
      set status = 'canceled', cancel_at_period_end = false, updated_at = now()
      where id = v_subscription.id;
    return jsonb_build_object('success', true, 'canceled', true, 'cancel_at_period_end', false);
  end if;

  update public.workspace_subscriptions
    set cancel_at_period_end = true, updated_at = now()
    where id = v_subscription.id;

  return jsonb_build_object(
    'success', true,
    'canceled', false,
    'cancel_at_period_end', true,
    'access_until', v_subscription.current_period_end
  );
end
$$;

revoke all on function public.request_workspace_subscription_cancellation(uuid) from public, anon;
grant execute on function public.request_workspace_subscription_cancellation(uuid) to authenticated;
