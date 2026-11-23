-- Marketplace SECURITY DEFINER functions use fully-qualified public/auth/private/storage
-- relations and can therefore run safely with an empty search_path.
alter function public.marketplace_create_creator_support_case(text,text,text,uuid,text) set search_path = '';
alter function public.marketplace_creator_earnings_summary() set search_path = '';
alter function public.marketplace_install_product(uuid,uuid) set search_path = '';
alter function public.marketplace_my_creator_analytics() set search_path = '';
alter function public.marketplace_my_creator_statements() set search_path = '';
alter function public.marketplace_my_creator_support_cases() set search_path = '';
alter function public.marketplace_my_payout_profile() set search_path = '';
alter function public.marketplace_my_payouts() set search_path = '';
alter function public.marketplace_my_subscriptions() set search_path = '';
alter function public.marketplace_product_is_public(uuid,uuid) set search_path = '';
alter function public.marketplace_request_payout(bigint,text) set search_path = '';
alter function public.marketplace_request_subscription_cancellation(uuid,text) set search_path = '';
alter function public.submit_marketplace_product(uuid,uuid) set search_path = '';
