-- Provider settlement import/reconciliation (service-only, additive).
begin;
create table if not exists public.marketplace_provider_settlement_batches(
 id uuid primary key default gen_random_uuid(),provider text not null,statement_reference text not null,
 statement_sha256 text not null check(statement_sha256 ~ '^[a-f0-9]{64}$'),
 imported_at timestamptz not null default now(),row_count integer not null check(row_count>=0),
 result jsonb not null default '{}'::jsonb, unique(provider,statement_reference)
);
create table if not exists public.marketplace_provider_settlement_rows(
 batch_id uuid not null references public.marketplace_provider_settlement_batches(id) on delete restrict,
 transfer_reference text not null,payout_request_id uuid references public.marketplace_payout_requests(id) on delete restrict,
 amount_minor bigint not null,currency char(3) not null check(currency='USD'),settled_at timestamptz not null,
 match_status text not null check(match_status in ('matched','amount_mismatch','currency_mismatch','unknown_transfer','duplicate_transfer')),
 primary key(batch_id,transfer_reference)
);
alter table public.marketplace_provider_settlement_batches enable row level security;
alter table public.marketplace_provider_settlement_rows enable row level security;
revoke all on public.marketplace_provider_settlement_batches,public.marketplace_provider_settlement_rows from anon,authenticated;
grant all on public.marketplace_provider_settlement_batches,public.marketplace_provider_settlement_rows to service_role;
create or replace function public.marketplace_reconcile_provider_settlement(p_provider text,p_statement_ref text,p_statement_sha256 text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare batch_id uuid; item jsonb; payout public.marketplace_payout_requests%rowtype; transfer text; rid uuid; amount bigint; currency text; ts timestamptz; status text; total int:=0; matched int:=0; mismatches int:=0; unknowns int:=0;
begin
 if auth.role()<>'service_role' then raise exception 'settlement_reconcile_service_role_required';end if;
 if nullif(trim(p_provider),'') is null or nullif(trim(p_statement_ref),'') is null or p_statement_sha256 !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 then raise exception 'invalid_settlement_statement';end if;
 insert into public.marketplace_provider_settlement_batches(provider,statement_reference,statement_sha256,row_count) values(p_provider,p_statement_ref,p_statement_sha256,jsonb_array_length(p_rows)) returning id into batch_id;
 for item in select value from jsonb_array_elements(p_rows) loop
  total:=total+1;transfer:=nullif(item->>'transferReference','');rid:=nullif(item->>'payoutRequestId','')::uuid;amount:=(item->>'amountMinor')::bigint;currency:=upper(item->>'currency');ts:=(item->>'settledAt')::timestamptz;
  if transfer is null or amount<=0 or currency is null or ts is null then raise exception 'invalid_settlement_row';end if;
  if exists(select 1 from public.marketplace_provider_settlement_rows r join public.marketplace_provider_settlement_batches b on b.id=r.batch_id where b.provider=p_provider and r.transfer_reference=transfer) then status:='duplicate_transfer';
  else select * into payout from public.marketplace_payout_requests where id=rid and payout_provider=p_provider and provider_transfer_id=transfer;
   if not found then status:='unknown_transfer';
   elsif payout.amount_minor<>amount then status:='amount_mismatch';
   elsif payout.currency<>currency then status:='currency_mismatch';
   elsif payout.status<>'paid' then status:='unknown_transfer';
   else status:='matched';matched:=matched+1;end if;
  end if;
  if status<>'matched' then mismatches:=mismatches+1;if status='unknown_transfer' then unknowns:=unknowns+1;end if;end if;
  insert into public.marketplace_provider_settlement_rows(batch_id,transfer_reference,payout_request_id,amount_minor,currency,settled_at,match_status) values(batch_id,transfer,rid,amount,currency,ts,status);
 end loop;
 update public.marketplace_provider_settlement_batches set result=jsonb_build_object('matched',matched,'exceptions',mismatches,'unknown',unknowns,'reconciled',mismatches=0) where id=batch_id;
 return jsonb_build_object('batchId',batch_id,'rows',total,'matched',matched,'exceptions',mismatches,'unknown',unknowns,'reconciled',mismatches=0);
end $$;
revoke all on function public.marketplace_reconcile_provider_settlement(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketplace_reconcile_provider_settlement(text,text,text,jsonb) to service_role;
commit;
