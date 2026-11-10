-- Plan-aware Paystack settlement: derive entitlements from the verified server-created payment.
create or replace function public.settle_paystack_workspace_payment(p_payment_id uuid,p_transaction_id bigint,p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payment public.billing_payments%rowtype;v_subscription public.workspace_subscriptions%rowtype;v_plan text;v_interval interval;v_start timestamptz;v_end timestamptz;v_last_paid_at timestamptz;v_paid_at timestamptz:=coalesce(p_paid_at,now());
begin
 if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501';end if;
 select * into v_payment from public.billing_payments where id=p_payment_id for update;
 if not found then raise exception 'payment not found' using errcode='P0002';end if;
 if v_payment.status='success' then return jsonb_build_object('success',true,'duplicate',true);end if;
 if v_payment.status<>'pending' then raise exception 'payment is not pending' using errcode='22023';end if;
 v_plan:=case v_payment.plan_slug when 'starter-monthly' then 'starter' when 'starter-annual' then 'starter' when 'pro-monthly' then 'pro' when 'pro-annual' then 'pro' when 'business-monthly' then 'business' when 'business-annual' then 'business' else null end;
 v_interval:=case when v_payment.plan_slug like '%-annual' then interval '1 year' else interval '1 month' end;
 if v_plan is null then raise exception 'unsupported payment plan' using errcode='22023';end if;
 update public.billing_payments set status='success',provider_transaction_id=p_transaction_id,paid_at=v_paid_at,updated_at=now() where id=v_payment.id;
 select * into v_subscription from public.workspace_subscriptions where workspace_id=v_payment.workspace_id for update;
 if found then
  if v_subscription.last_payment_id is not null then
   select paid_at into v_last_paid_at from public.billing_payments where id=v_subscription.last_payment_id;
   if v_last_paid_at is not null and v_last_paid_at>=v_paid_at then return jsonb_build_object('success',false,'stale_payment',true);end if;
  end if;
  if v_subscription.current_period_end>v_paid_at then v_start:=v_subscription.current_period_start;v_end:=v_subscription.current_period_end+v_interval;
  else v_start:=v_paid_at;v_end:=v_paid_at+v_interval;end if;
 else v_start:=v_paid_at;v_end:=v_paid_at+v_interval;end if;
 insert into public.workspace_subscriptions(workspace_id,plan_key,status,billing_provider,current_period_start,current_period_end,cancel_at_period_end,last_payment_id,updated_at)
 values(v_payment.workspace_id,v_plan,'active','paystack',v_start,v_end,false,v_payment.id,now())
 on conflict(workspace_id) do update set plan_key=excluded.plan_key,status='active',billing_provider='paystack',current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,cancel_at_period_end=false,last_payment_id=excluded.last_payment_id,updated_at=now();
 return jsonb_build_object('success',true,'duplicate',false,'plan_key',v_plan,'period_end',v_end);
end;$$;
revoke all on function public.settle_paystack_workspace_payment(uuid,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_paystack_workspace_payment(uuid,bigint,timestamptz) to service_role;
