-- Phase 3 finance safety: service-only payout settlement with idempotent transfer references.
create unique index if not exists marketplace_payout_provider_transfer_unique
 on public.marketplace_payout_requests(payout_provider,provider_transfer_id)
 where payout_provider is not null and provider_transfer_id is not null;

create or replace function public.marketplace_settle_payout(
 p_request_id uuid,p_provider text,p_transfer_id text,p_event_id text,p_payload_sha256 text,p_settled_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare payout public.marketplace_payout_requests%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'payout_settlement_service_role_required'; end if;
 if nullif(trim(p_provider),'') is null or nullif(trim(p_transfer_id),'') is null or
  nullif(trim(p_event_id),'') is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid_payout_settlement'; end if;
 perform pg_advisory_xact_lock(hashtextextended('marketplace-payout-settle:'||p_request_id::text,0));
 select * into payout from public.marketplace_payout_requests where id=p_request_id for update;
 if not found then raise exception 'payout_request_not_found'; end if;
 if payout.status='paid' then
  if payout.payout_provider=p_provider and payout.provider_transfer_id=p_transfer_id then
   return jsonb_build_object('status','duplicate_settlement','request_id',payout.id);
  end if;
  raise exception 'payout_settlement_conflict';
 end if;
 if payout.status<>'processing' then raise exception 'payout_not_processing'; end if;
 if exists(select 1 from public.marketplace_payout_requests where payout_provider=p_provider and provider_transfer_id=p_transfer_id and id<>p_request_id) then raise exception 'payout_transfer_reference_reused'; end if;
 update public.marketplace_payout_requests set status='paid',payout_provider=p_provider,provider_transfer_id=p_transfer_id,
  processed_at=p_settled_at,failure_code=null where id=p_request_id;
 insert into public.marketplace_financial_ledger(creator_id,payout_request_id,provider,provider_event_id,entry_type,amount_minor,currency,memo)
 values(payout.creator_id,payout.id,p_provider,p_event_id,'payout',-payout.amount_minor,payout.currency,'Verified provider payout settlement');
 return jsonb_build_object('status','paid','request_id',payout.id,'transfer_id',p_transfer_id);
end; $$;
revoke all on function public.marketplace_settle_payout(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_settle_payout(uuid,text,text,text,text,timestamptz) to service_role;
