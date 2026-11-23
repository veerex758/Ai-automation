-- Workspace owners are administrators even when they do not have a duplicate
-- workspace_members row. Preserve the admin guard for non-owner members.
create or replace function public.request_workspace_subscription_cancellation(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_subscription public.workspace_subscriptions%rowtype;
  v_actor uuid := auth.uid();
begin
  if v_actor is null or p_workspace_id is null or not (
    exists(select 1 from public.workspaces w where w.id=p_workspace_id and w.owner_id=v_actor)
    or private.is_workspace_admin(p_workspace_id)
  ) then
    raise exception 'workspace billing administrator required' using errcode='42501';
  end if;

  select * into v_subscription from public.workspace_subscriptions
    where workspace_id=p_workspace_id for update;
  if not found then return jsonb_build_object('success',false,'reason','subscription_not_found'); end if;
  if v_subscription.plan_key='free' or v_subscription.status='canceled' then
    return jsonb_build_object('success',false,'reason','no_active_paid_subscription');
  end if;
  if v_subscription.cancel_at_period_end then
    return jsonb_build_object('success',true,'already_scheduled',true,'cancel_at_period_end',true,'current_period_end',v_subscription.current_period_end);
  end if;
  if v_subscription.current_period_end<=now() then
    update public.workspace_subscriptions set status='canceled',cancel_at_period_end=false,updated_at=now()
      where id=v_subscription.id;
    return jsonb_build_object('success',true,'canceled',true,'cancel_at_period_end',false);
  end if;
  update public.workspace_subscriptions set cancel_at_period_end=true,updated_at=now() where id=v_subscription.id;
  return jsonb_build_object('success',true,'canceled',false,'cancel_at_period_end',true,'access_until',v_subscription.current_period_end);
end
$function$;
