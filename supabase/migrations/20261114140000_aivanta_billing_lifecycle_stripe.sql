-- Stripe one-time checkout readiness, payment reconciliation metadata and subscription lifecycle.
alter table public.billing_payments drop constraint if exists billing_payments_provider_check;
alter table public.billing_payments add constraint billing_payments_provider_check check(provider in ('paystack','stripe'));
alter table public.billing_payments add column if not exists provider_transaction_ref text;
alter table public.billing_webhook_events drop constraint if exists billing_webhook_events_provider_check;
alter table public.billing_webhook_events add constraint billing_webhook_events_provider_check check(provider in ('paystack','stripe'));

alter table public.workspace_subscriptions
 add column if not exists pending_plan_key text check (pending_plan_key is null or pending_plan_key in ('free','starter','pro','business','enterprise')),
 add column if not exists pending_plan_effective_at timestamptz,
 add column if not exists grace_until timestamptz;

create or replace function public.settle_stripe_workspace_payment(p_payment_id uuid,p_session_id text,p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payment public.billing_payments%rowtype;v_subscription public.workspace_subscriptions%rowtype;v_plan text;v_interval interval;v_paid_at timestamptz:=coalesce(p_paid_at,now());v_start timestamptz;v_end timestamptz;
begin
 if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
 select * into v_payment from public.billing_payments where id=p_payment_id for update;
 if not found then raise exception 'payment not found' using errcode='P0002';end if;
 if v_payment.provider<>'stripe' then raise exception 'wrong payment provider' using errcode='22023';end if;
 if v_payment.status='success' then return jsonb_build_object('success',true,'duplicate',true);end if;
 if v_payment.status<>'pending' then raise exception 'payment is not pending' using errcode='22023';end if;
 v_plan:=case v_payment.plan_slug when 'starter-monthly' then 'starter' when 'starter-annual' then 'starter' when 'pro-monthly' then 'pro' when 'pro-annual' then 'pro' when 'business-monthly' then 'business' when 'business-annual' then 'business' else null end;
 v_interval:=case when v_payment.plan_slug like '%-annual' then interval '1 year' else interval '1 month' end;
 if v_plan is null then raise exception 'unsupported payment plan' using errcode='22023';end if;
 update public.billing_payments set status='success',provider_transaction_ref=p_session_id,paid_at=v_paid_at,updated_at=now() where id=v_payment.id;
 select * into v_subscription from public.workspace_subscriptions where workspace_id=v_payment.workspace_id for update;
 if found then
  if v_subscription.current_period_end>v_paid_at then v_start:=v_subscription.current_period_start;v_end:=v_subscription.current_period_end+v_interval;
  else v_start:=v_paid_at;v_end:=v_paid_at+v_interval;end if;
 else v_start:=v_paid_at;v_end:=v_paid_at+v_interval;end if;
 insert into public.workspace_subscriptions(workspace_id,plan_key,status,billing_provider,current_period_start,current_period_end,cancel_at_period_end,last_payment_id,updated_at)
 values(v_payment.workspace_id,v_plan,'active','stripe',v_start,v_end,false,v_payment.id,now())
 on conflict(workspace_id) do update set plan_key=excluded.plan_key,status='active',billing_provider='stripe',current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,cancel_at_period_end=false,pending_plan_key=null,pending_plan_effective_at=null,grace_until=null,last_payment_id=excluded.last_payment_id,updated_at=now();
 return jsonb_build_object('success',true,'duplicate',false,'plan_key',v_plan,'period_end',v_end);
end $$;
revoke all on function public.settle_stripe_workspace_payment(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_stripe_workspace_payment(uuid,text,timestamptz) to service_role;

create or replace function public.expire_workspace_subscriptions()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_expired integer:=0;v_changed integer:=0;
begin
 if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
 update public.workspace_subscriptions set status='canceled',cancel_at_period_end=false,updated_at=now()
 where cancel_at_period_end=true and current_period_end<=now() and status not in ('canceled','incomplete');
 get diagnostics v_expired=row_count;
 update public.workspace_subscriptions set plan_key=pending_plan_key,pending_plan_key=null,pending_plan_effective_at=null,updated_at=now()
 where pending_plan_key is not null and pending_plan_effective_at<=now() and current_period_end>now() and status in ('active','trialing');
 get diagnostics v_changed=row_count;
 update public.billing_payments set status='abandoned',updated_at=now()
 where status='pending' and created_at<now()-interval '48 hours';
 return jsonb_build_object('canceled_subscriptions',v_expired,'applied_plan_changes',v_changed);
end $$;
revoke all on function public.expire_workspace_subscriptions() from public,anon,authenticated;
grant execute on function public.expire_workspace_subscriptions() to service_role;
