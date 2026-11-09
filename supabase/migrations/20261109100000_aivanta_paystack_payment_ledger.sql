-- Paystack payment attempt and webhook ledger. workspace_subscriptions is owned by Phase 5.
create table if not exists public.billing_payments(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete restrict,provider text not null default 'paystack' check(provider='paystack'),
 reference text not null unique,plan_slug text not null,amount_minor bigint not null check(amount_minor>0),
 currency text not null check(currency ~ '^[A-Z]{3}$'),status text not null default 'pending' check(status in('pending','success','failed','abandoned','refunded')),
 authorization_url text,access_code text,provider_transaction_id bigint,paid_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,reference));
create index if not exists billing_payments_workspace_created_idx on public.billing_payments(workspace_id,created_at desc);
create table if not exists public.billing_webhook_events(
 id uuid primary key default gen_random_uuid(),provider text not null default 'paystack' check(provider='paystack'),
 event_key text not null unique,event_type text not null,reference text,received_at timestamptz not null default now(),processed_at timestamptz);
alter table public.billing_payments enable row level security;alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_payments,public.billing_webhook_events from public,anon,authenticated;
grant select on public.billing_payments to authenticated;grant all on public.billing_payments,public.billing_webhook_events to service_role;
drop policy if exists billing_payments_workspace_read on public.billing_payments;
create policy billing_payments_workspace_read on public.billing_payments for select to authenticated using(private.is_workspace_member(workspace_id));
comment on table public.billing_payments is 'Server-created Paystack payment attempts; client writes denied.';
comment on table public.billing_webhook_events is 'Server-only idempotency ledger for verified Paystack events.';

alter table public.workspace_subscriptions add column if not exists last_payment_id uuid references public.billing_payments(id) on delete set null;
create or replace function public.settle_paystack_workspace_payment(p_payment_id uuid,p_transaction_id bigint,p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payment public.billing_payments%rowtype;v_subscription public.workspace_subscriptions%rowtype;v_start timestamptz;v_end timestamptz;v_last_paid_at timestamptz;
begin
 if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501';end if;
 select * into v_payment from public.billing_payments where id=p_payment_id for update;
 if not found then raise exception 'payment not found' using errcode='P0002';end if;
 if v_payment.status='success' then return jsonb_build_object('success',true,'duplicate',true);end if;
 if v_payment.status<>'pending' then raise exception 'payment is not pending' using errcode='22023';end if;
 update public.billing_payments set status='success',provider_transaction_id=p_transaction_id,paid_at=coalesce(p_paid_at,now()),updated_at=now() where id=v_payment.id;
 select * into v_subscription from public.workspace_subscriptions where workspace_id=v_payment.workspace_id for update;
 if found and v_subscription.current_period_end>coalesce(p_paid_at,now()) then v_start:=v_subscription.current_period_start;v_end:=v_subscription.current_period_end+interval '30 days';
 else v_start:=coalesce(p_paid_at,now());v_end:=coalesce(p_paid_at,now())+interval '30 days';end if;
 insert into public.workspace_subscriptions(workspace_id,plan_key,status,billing_provider,current_period_start,current_period_end,cancel_at_period_end,last_payment_id,updated_at)
 values(v_payment.workspace_id,'pro','active','paystack',v_start,v_end,false,v_payment.id,now())
 on conflict(workspace_id) do update set plan_key='pro',status='active',billing_provider='paystack',current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,cancel_at_period_end=false,last_payment_id=excluded.last_payment_id,updated_at=now();
 return jsonb_build_object('success',true,'duplicate',false);
end;$$;
revoke all on function public.settle_paystack_workspace_payment(uuid,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_paystack_workspace_payment(uuid,bigint,timestamptz) to service_role;
