-- Marketplace settlement controls. Eligibility is a report only; it never sends money.
alter table public.marketplace_creators add column if not exists payout_status text not null default 'unconfigured'
 check(payout_status in ('unconfigured','pending','verified','rejected'));
create index if not exists marketplace_creator_payout_status_idx on public.marketplace_creators(status,payout_status);

create or replace function public.marketplace_creator_payout_eligibility(p_minimum_minor bigint default 5000)
returns table(creator_id uuid,display_name text,payout_provider text,payout_status text,
 gross_earned_minor bigint,reversed_minor bigint,already_paid_minor bigint,eligible_minor bigint,
 reconciliation_clear boolean,eligible boolean,reason text)
language sql stable security definer set search_path=public,pg_temp as $$
 with creator_balances as (
  select c.id,c.display_name,c.payout_provider,c.payout_account_ref,c.payout_status,c.status,
   coalesce(sum(case when l.entry_type='creator_earning' then l.amount_minor else 0 end),0)::bigint earned,
   coalesce(sum(case when l.entry_type='creator_earning_reversal' then -l.amount_minor else 0 end),0)::bigint reversed,
   coalesce(sum(case when l.entry_type='payout' then -l.amount_minor else 0 end),0)::bigint paid
  from public.marketplace_creators c left join public.marketplace_financial_ledger l on l.creator_id=c.id
  group by c.id,c.display_name,c.payout_provider,c.payout_account_ref,c.payout_status,c.status
 ), reconciliation as (
  select c.id,not exists(
   select 1 from public.marketplace_purchases p
   left join public.marketplace_financial_ledger l on l.purchase_id=p.id and l.entry_type='gross_sale'
   where p.product_id in (select id from public.marketplace_products where creator_id=c.id)
   group by p.id,p.status,p.amount_minor
   having (case when p.status in ('paid','refunded','disputed') then p.amount_minor::bigint else 0 end)<>coalesce(sum(l.amount_minor),0)
  ) clear
  from public.marketplace_creators c
 )
 select b.id,b.display_name,b.payout_provider,b.payout_status,b.earned,b.reversed,b.paid,
  greatest(0,b.earned-b.reversed-b.paid)::bigint eligible_minor,r.clear,
  (b.status='verified' and b.payout_status='verified' and nullif(trim(b.payout_provider),'') is not null
   and nullif(trim(b.payout_account_ref),'') is not null and r.clear
   and greatest(0,b.earned-b.reversed-b.paid)>=greatest(1,p_minimum_minor)),
  case when b.status<>'verified' then 'creator_not_verified'
   when b.payout_status<>'verified' then 'payout_kyc_not_verified'
   when nullif(trim(b.payout_provider),'') is null or nullif(trim(b.payout_account_ref),'') is null then 'payout_destination_missing'
   when not r.clear then 'settlement_reconciliation_required'
   when greatest(0,b.earned-b.reversed-b.paid)<greatest(1,p_minimum_minor) then 'below_minimum_payout'
   else 'eligible' end
 from creator_balances b join reconciliation r on r.id=b.id order by b.display_name;
$$;
revoke all on function public.marketplace_creator_payout_eligibility(bigint) from public,anon,authenticated;
grant execute on function public.marketplace_creator_payout_eligibility(bigint) to service_role;

-- Reconciliation RPC is service-only; no payout mutation or provider transfer is exposed.
comment on function public.marketplace_creator_payout_eligibility(bigint) is
 'Read-only payout eligibility report. Requires verified creator, verified payout/KYC destination, clear gross-sale reconciliation, and minimum balance. Does not initiate transfers.';
