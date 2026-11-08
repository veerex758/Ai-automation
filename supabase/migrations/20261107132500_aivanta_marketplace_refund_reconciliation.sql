alter table public.marketplace_financial_ledger drop constraint if exists marketplace_financial_ledger_entry_type_check;
alter table public.marketplace_financial_ledger add constraint marketplace_financial_ledger_entry_type_check
check(entry_type in ('gross_sale','platform_commission','creator_earning','payment_fee','tax','refund','chargeback','payout','platform_commission_reversal','creator_earning_reversal'));

create or replace function public.marketplace_record_refund(p_purchase_id uuid,p_provider text,p_event_id text,p_refund_minor integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_purchases;ev uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 insert into public.marketplace_payment_events(provider,event_id,event_type,purchase_id) values(p_provider,p_event_id,'payment.refunded',p_purchase_id) on conflict(provider,event_id) do nothing returning id into ev;
 if ev is null then return jsonb_build_object('duplicate',true); end if;
 select * into p from public.marketplace_purchases where id=p_purchase_id for update;
 if not found or p.status not in ('paid','disputed') or p_refund_minor<>p.amount_minor then raise exception 'only full refunds are supported; amount must equal purchase total'; end if;
 update public.marketplace_purchases set status='refunded',refunded_at=now() where id=p.id;
 update public.marketplace_entitlements set status='revoked' where purchase_id=p.id and status='active';
 insert into public.marketplace_financial_ledger(event_id,purchase_id,creator_id,entry_type,amount_minor) values
 (ev,p.id,null,'refund',p_refund_minor),
 (ev,p.id,null,'platform_commission_reversal',p.platform_fee_minor);
 if p.creator_id is not null then insert into public.marketplace_financial_ledger(event_id,purchase_id,creator_id,entry_type,amount_minor) values(ev,p.id,p.creator_id,'creator_earning_reversal',p.creator_earning_minor); end if;
 update public.marketplace_payment_events set processed_at=now() where id=ev;
 return jsonb_build_object('purchase_id',p.id,'refund_minor',p_refund_minor,'status','refunded');
end $$;
revoke all on function public.marketplace_record_refund(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.marketplace_record_refund(uuid,text,text,integer) to service_role;
