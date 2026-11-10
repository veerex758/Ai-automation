-- Phase 3 creator analytics: only ledger and subscription facts, no guessed conversion.
create or replace function public.marketplace_my_creator_analytics()
returns table(gross_sales_minor bigint,sales_count bigint,commission_minor bigint,
 creator_earnings_minor bigint,reversal_minor bigint,active_subscriptions bigint,past_due_subscriptions bigint)
language sql stable security definer set search_path=public,pg_temp as $$
 select
  coalesce((select sum(l.amount_minor) from public.marketplace_financial_ledger l where l.creator_id=c.id and l.entry_type='gross_sale'),0)::bigint,
  coalesce((select count(distinct l.purchase_id) from public.marketplace_financial_ledger l where l.creator_id=c.id and l.entry_type='gross_sale'),0)::bigint,
  coalesce((select sum(l.amount_minor) from public.marketplace_financial_ledger l where l.creator_id=c.id and l.entry_type='platform_commission'),0)::bigint,
  coalesce((select sum(l.amount_minor) from public.marketplace_financial_ledger l where l.creator_id=c.id and l.entry_type='creator_earning'),0)::bigint,
  coalesce((select sum(-l.amount_minor) from public.marketplace_financial_ledger l where l.creator_id=c.id and l.entry_type in ('creator_earning_reversal','refund','chargeback')),0)::bigint,
  coalesce((select count(*) from public.marketplace_subscriptions s where s.product_id in (select p.id from public.marketplace_products p where p.creator_id=c.id) and s.status='active'),0)::bigint,
  coalesce((select count(*) from public.marketplace_subscriptions s where s.product_id in (select p.id from public.marketplace_products p where p.creator_id=c.id) and s.status='past_due'),0)::bigint
 from public.marketplace_creators c where c.user_id=auth.uid() and c.status='verified';
$$;
revoke all on function public.marketplace_my_creator_analytics() from public,anon;
grant execute on function public.marketplace_my_creator_analytics() to authenticated;
