-- Phase 3 recurring payment ledger: each verified invoice is balanced once.
alter table public.marketplace_financial_ledger add column if not exists subscription_id uuid references public.marketplace_subscriptions(id) on delete restrict;
alter table public.marketplace_financial_ledger add column if not exists provider_payment_id text;
create unique index if not exists marketplace_ledger_subscription_provider_payment_unique
 on public.marketplace_financial_ledger(provider,provider_payment_id,entry_type,subscription_id)
 where provider_payment_id is not null and subscription_id is not null;
create unique index if not exists marketplace_ledger_subscription_event_type_unique
 on public.marketplace_financial_ledger(provider,provider_event_id,entry_type,subscription_id)
 where subscription_id is not null and provider is not null and provider_event_id is not null;

create or replace function public.marketplace_record_subscription_payment(
 p_provider text,p_event_id text,p_subscription_id uuid,p_provider_payment_id text,
 p_amount_minor bigint,p_currency text,p_payload_sha256 text,p_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare sub public.marketplace_subscriptions%rowtype; commission bigint; earning bigint; event_row public.marketplace_subscription_events%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'subscription_payment_service_role_required'; end if;
 if nullif(trim(p_provider),'') is null or nullif(trim(p_event_id),'') is null or
  nullif(trim(p_provider_payment_id),'') is null or p_amount_minor<=0 or p_currency<>'USD' or p_occurred_at is null or
  p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
  raise exception 'invalid_subscription_payment';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('marketplace-sub-invoice:'||p_provider||':'||p_event_id,0));
 select * into event_row from public.marketplace_subscription_events
 where provider=p_provider and provider_event_id=p_event_id;
 if not found or event_row.event_type<>'invoice.paid' or event_row.payload_sha256<>p_payload_sha256 or event_row.outcome<>'processed' then
  raise exception 'subscription_invoice_event_unverified';
 end if;
 select * into sub from public.marketplace_subscriptions where id=p_subscription_id and provider=p_provider for update;
 if not found then raise exception 'subscription_not_found'; end if;
 if event_row.subscription_id is distinct from sub.id then raise exception 'subscription_invoice_subscription_mismatch'; end if;
 if event_row.occurred_at is distinct from p_occurred_at then raise exception 'subscription_invoice_timestamp_mismatch'; end if;
 if exists(select 1 from public.marketplace_financial_ledger where provider=p_provider and provider_payment_id=p_provider_payment_id and subscription_id<>sub.id) then raise exception 'subscription_payment_id_reused'; end if;
 if exists(select 1 from public.marketplace_financial_ledger where provider=p_provider and provider_event_id=p_event_id and subscription_id=sub.id and entry_type='gross_sale') then
  return jsonb_build_object('status','duplicate_invoice','subscription_id',sub.id);
 end if;
 commission:=floor(p_amount_minor*0.20); earning:=p_amount_minor-commission;
 insert into public.marketplace_financial_ledger(subscription_id,creator_id,provider,provider_event_id,provider_payment_id,entry_type,amount_minor,currency,memo)
 select sub.id,p.creator_id,p_provider,p_event_id,p_provider_payment_id,'gross_sale',p_amount_minor,p_currency,'Verified recurring subscription invoice'
 from public.marketplace_products p where p.id=sub.product_id
 union all
 select sub.id,p.creator_id,p_provider,p_event_id,p_provider_payment_id,'platform_commission',commission,p_currency,'Aivanta 20% recurring commission'
 from public.marketplace_products p where p.id=sub.product_id
 union all
 select sub.id,p.creator_id,p_provider,p_event_id,p_provider_payment_id,'creator_earning',earning,p_currency,'Creator 80% recurring earning before fees/tax'
 from public.marketplace_products p where p.id=sub.product_id;
 return jsonb_build_object('status','recorded','subscription_id',sub.id,'gross_minor',p_amount_minor,'commission_minor',commission,'creator_earning_minor',earning);
end; $$;
revoke all on function public.marketplace_record_subscription_payment(text,text,uuid,text,bigint,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_record_subscription_payment(text,text,uuid,text,bigint,text,text,timestamptz) to service_role;
