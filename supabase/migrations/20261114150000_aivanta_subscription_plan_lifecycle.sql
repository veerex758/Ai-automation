-- Shared plan-aware settlement for Paystack and Stripe, scheduled downgrades, and expiry enforcement.
create or replace function public.settle_workspace_payment(
 p_payment_id uuid,p_provider text,p_provider_transaction_ref text,p_provider_transaction_id bigint,p_paid_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_payment public.billing_payments%rowtype;v_subscription public.workspace_subscriptions%rowtype;
 v_plan text;v_interval interval;v_paid_at timestamptz:=coalesce(p_paid_at,now());
 v_start timestamptz;v_end timestamptz;v_last_paid_at timestamptz;
 v_current_rank integer;v_new_rank integer;v_downgrade boolean:=false;
begin
 if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
 if p_provider not in ('paystack','stripe') then raise exception 'unsupported billing provider' using errcode='22023';end if;
 select * into v_payment from public.billing_payments where id=p_payment_id for update;
 if not found then raise exception 'payment not found' using errcode='P0002';end if;
 if v_payment.provider<>p_provider then raise exception 'payment provider mismatch' using errcode='22023';end if;
 if v_payment.status='success' then return jsonb_build_object('success',true,'duplicate',true);end if;
 if v_payment.status<>'pending' then raise exception 'payment is not pending' using errcode='22023';end if;
 v_plan:=case v_payment.plan_slug
  when 'starter-monthly' then 'starter' when 'starter-annual' then 'starter'
  when 'pro-monthly' then 'pro' when 'pro-annual' then 'pro'
  when 'business-monthly' then 'business' when 'business-annual' then 'business' else null end;
 v_interval:=case when v_payment.plan_slug like '%-annual' then interval '1 year' else interval '1 month' end;
 if v_plan is null then raise exception 'unsupported payment plan' using errcode='22023';end if;
 update public.billing_payments set status='success',provider_transaction_id=p_provider_transaction_id,
  provider_transaction_ref=p_provider_transaction_ref,paid_at=v_paid_at,updated_at=now() where id=v_payment.id;
 select * into v_subscription from public.workspace_subscriptions where workspace_id=v_payment.workspace_id for update;
 if found then
  if v_subscription.last_payment_id is not null then
   select paid_at into v_last_paid_at from public.billing_payments where id=v_subscription.last_payment_id;
   if v_last_paid_at is not null and v_last_paid_at>=v_paid_at then return jsonb_build_object('success',false,'stale_payment',true);end if;
  end if;
  v_current_rank:=case v_subscription.plan_key when 'free' then 0 when 'starter' then 1 when 'pro' then 2 when 'business' then 3 when 'enterprise' then 4 else 0 end;
  v_new_rank:=case v_plan when 'starter' then 1 when 'pro' then 2 when 'business' then 3 else 0 end;
  if v_subscription.current_period_end>v_paid_at then
   v_start:=v_subscription.current_period_start;
   v_end:=v_subscription.current_period_end+v_interval;
   v_downgrade:=v_new_rank<v_current_rank;
  else
   v_start:=v_paid_at;v_end:=v_paid_at+v_interval;
  end if;
 else
  v_start:=v_paid_at;v_end:=v_paid_at+v_interval;
 end if;
 if v_downgrade then
  update public.workspace_subscriptions set status='active',billing_provider=p_provider,
   pending_plan_key=v_plan,pending_plan_effective_at=v_subscription.current_period_end,
   current_period_start=v_start,current_period_end=v_end,cancel_at_period_end=false,
   grace_until=null,last_payment_id=v_payment.id,updated_at=now()
  where workspace_id=v_payment.workspace_id;
 else
  insert into public.workspace_subscriptions(workspace_id,plan_key,status,billing_provider,current_period_start,current_period_end,cancel_at_period_end,last_payment_id,pending_plan_key,pending_plan_effective_at,grace_until,updated_at)
  values(v_payment.workspace_id,v_plan,'active',p_provider,v_start,v_end,false,v_payment.id,null,null,null,now())
  on conflict(workspace_id) do update set plan_key=excluded.plan_key,status='active',billing_provider=excluded.billing_provider,
   current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
   cancel_at_period_end=false,pending_plan_key=null,pending_plan_effective_at=null,grace_until=null,
   last_payment_id=excluded.last_payment_id,updated_at=now();
 end if;
 return jsonb_build_object('success',true,'duplicate',false,'plan_key',v_plan,'scheduled_downgrade',v_downgrade,
  'effective_at',case when v_downgrade then v_subscription.current_period_end else v_start end,'period_end',v_end);
end $$;
revoke all on function public.settle_workspace_payment(uuid,text,text,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_workspace_payment(uuid,text,text,bigint,timestamptz) to service_role;

create or replace function public.settle_paystack_workspace_payment(p_payment_id uuid,p_transaction_id bigint,p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return public.settle_workspace_payment(p_payment_id,'paystack',null,p_transaction_id,p_paid_at);
end $$;
revoke all on function public.settle_paystack_workspace_payment(uuid,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_paystack_workspace_payment(uuid,bigint,timestamptz) to service_role;

create or replace function public.settle_stripe_workspace_payment(p_payment_id uuid,p_session_id text,p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return public.settle_workspace_payment(p_payment_id,'stripe',p_session_id,null,p_paid_at);
end $$;
revoke all on function public.settle_stripe_workspace_payment(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_stripe_workspace_payment(uuid,text,timestamptz) to service_role;

create or replace function public.expire_workspace_subscriptions()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_expired integer:=0;v_changed integer:=0;
begin
 if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
 update public.workspace_subscriptions set plan_key=pending_plan_key,pending_plan_key=null,pending_plan_effective_at=null,updated_at=now()
 where pending_plan_key is not null and pending_plan_effective_at<=now() and current_period_end>now() and status in ('active','trialing');
 get diagnostics v_changed=row_count;
 update public.workspace_subscriptions set status='canceled',cancel_at_period_end=false,pending_plan_key=null,pending_plan_effective_at=null,updated_at=now()
 where current_period_end<=now() and status in ('active','trialing','past_due');
 get diagnostics v_expired=row_count;
 update public.billing_payments set status='abandoned',updated_at=now()
 where status='pending' and created_at<now()-interval '48 hours';
 return jsonb_build_object('canceled_subscriptions',v_expired,'applied_plan_changes',v_changed);
end $$;
revoke all on function public.expire_workspace_subscriptions() from public,anon,authenticated;
grant execute on function public.expire_workspace_subscriptions() to service_role;
