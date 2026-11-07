-- Phase 3 follow-up: creator-safe payout onboarding visibility.
-- The creator can see compliance state but never provider account identifiers.
create or replace function public.marketplace_my_payout_profile()
returns table(provider text,country_code char(2),onboarding_status text,tax_status text,
 payouts_enabled boolean,minimum_payout_minor bigint,hold_until timestamptz,verified_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select p.provider,p.country_code,p.onboarding_status,p.tax_status,p.payouts_enabled,
  p.minimum_payout_minor,p.hold_until,p.verified_at
 from public.marketplace_creator_payout_profiles p
 join public.marketplace_creators c on c.id=p.creator_id
 where c.user_id=auth.uid() and c.status='verified';
$$;
revoke all on function public.marketplace_my_payout_profile() from public,anon;
grant execute on function public.marketplace_my_payout_profile() to authenticated;
