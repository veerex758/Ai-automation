begin;
select plan(10);

select has_table('public','marketplace_subscriptions','subscription lifecycle table exists');
select has_table('public','marketplace_subscription_events','subscription event inbox exists');
select has_table('public','marketplace_payout_requests','payout requests are durable');
select has_table('public','marketplace_creator_statements','creator period statements are durable');
select has_function('public','marketplace_creator_earnings_summary','creator earnings summary RPC exists');
select has_function('public','marketplace_request_payout','payout request RPC exists');
select has_function('public','marketplace_review_payout_request','finance review RPC exists');
select ok(not has_table_privilege('authenticated','public.marketplace_payout_requests','SELECT'),'payout request rows are not directly readable by authenticated clients');
select ok(not has_table_privilege('authenticated','public.marketplace_subscription_events','SELECT'),'provider subscription events are private');
select ok(not has_function_privilege('anon','public.marketplace_request_payout(bigint,text)','EXECUTE'),'anonymous users cannot request creator payouts');

select * from finish();
rollback;
