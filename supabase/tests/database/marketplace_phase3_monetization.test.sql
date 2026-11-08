begin;
select plan(63);

select has_table('public','marketplace_subscriptions','subscription lifecycle table exists');
select has_table('public','marketplace_subscription_events','subscription event inbox exists');
select has_table('public','marketplace_payout_requests','payout requests are durable');
select has_table('public','marketplace_creator_statements','creator period statements are durable');
select has_table('public','marketplace_creator_support_cases','creator support cases are durable');
select has_function('public','marketplace_creator_earnings_summary','creator earnings summary RPC exists');
select has_function('public','marketplace_apply_subscription_event','subscription event dispatcher exists');
select has_function('public','marketplace_request_payout','payout request RPC exists');
select has_function('public','marketplace_review_payout_request','finance review RPC exists');
select has_function('public','marketplace_generate_creator_statement','statement snapshot RPC exists');
select has_table('public','marketplace_creator_payout_profiles','payout onboarding and compliance profile exists');
select has_function('public','marketplace_set_creator_payout_profile','service-only payout onboarding RPC exists');
select has_function('public','marketplace_my_subscriptions','buyer can read own subscription status through RPC');
select has_function('public','marketplace_request_subscription_cancellation','buyer cancellation request RPC exists');
select has_function('public','marketplace_my_creator_statements','creator statement read RPC exists');
select has_function('public','marketplace_update_subscription_command','service-only cancellation command processor exists');
select has_function('public','marketplace_my_payout_profile','creator-safe payout onboarding status RPC exists');
select has_function('public','marketplace_my_creator_analytics','ledger-backed creator analytics RPC exists');
select has_function('public','marketplace_create_creator_support_case','creator support case submission RPC exists');
select ok(not has_table_privilege('authenticated','public.marketplace_payout_requests','SELECT'),'payout rows are private');
select ok(not has_table_privilege('authenticated','public.marketplace_subscription_events','SELECT'),'provider events are private');
select ok(not has_function_privilege('anon','public.marketplace_request_payout(bigint,text)','EXECUTE'),'anon cannot request payouts');
select ok(not has_function_privilege('authenticated','public.marketplace_apply_subscription_event(text,text,text,text,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz)','EXECUTE'),'subscription event application is service-only');
select ok(not has_function_privilege('authenticated','public.marketplace_set_creator_payout_profile(uuid,text,text,text,text,text,boolean,bigint,timestamptz)','EXECUTE'),'payout onboarding writes are service-only');

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values
 ('a2222222-2222-4222-8222-222222222222','authenticated','authenticated','marketplace-phase3-creator@example.invalid','',now(),now()),
 ('a1111111-1111-4111-8111-111111111111','authenticated','authenticated','marketplace-phase3-buyer@example.invalid','',now(),now())
on conflict(id) do nothing;
insert into public.marketplace_creators(id,user_id,display_name,slug,status,payout_provider,payout_account_ref)
values('c2222222-2222-4222-8222-222222222222','a2222222-2222-4222-8222-222222222222','Phase3 Creator','phase3-test-creator','verified','mock','acct-test')
on conflict(id) do update set status='verified',payout_provider='mock',payout_account_ref='acct-test';
insert into public.marketplace_categories(id,slug,name)
values('d3333333-3333-4333-8333-333333333333','phase3-category','Phase 3') on conflict(id) do nothing;
insert into public.marketplace_products(id,creator_id,category_id,slug,name,summary,product_type,pricing_type,price_minor,currency,recurring_interval,status,created_by)
values('e4444444-4444-4444-8444-444444444444','c2222222-2222-4222-8222-222222222222','d3333333-3333-4333-8333-333333333333','phase3-recurring','Phase 3 Recurring','Fixture','workflow','recurring',1000,'USD','month','published','a2222222-2222-4222-8222-222222222222')
on conflict(id) do nothing;
insert into public.marketplace_product_versions(id,product_id,version,artifact_path,artifact_sha256,verification_status,created_by)
values('f5555555-5555-4555-8555-555555555555','e4444444-4444-4444-8444-444444444444','1.0.0','private/phase3.zip',repeat('b',64),'approved','a2222222-2222-4222-8222-222222222222')
on conflict(id) do nothing;
update public.marketplace_products set current_version_id='f5555555-5555-4555-8555-555555555555' where id='e4444444-4444-4444-8444-444444444444';
insert into public.marketplace_financial_ledger(creator_id,entry_type,amount_minor,currency,memo)
values('c2222222-2222-4222-8222-222222222222','creator_earning',3000,'USD','Phase 3 test balance');
insert into public.marketplace_creator_payout_profiles(creator_id,provider,provider_account_ref,country_code,onboarding_status,tax_status,payouts_enabled,minimum_payout_minor)
values('c2222222-2222-4222-8222-222222222222','mock','acct-test','NG','verified','complete',true,1000);

set local role authenticated;
select set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is((select onboarding_status from public.marketplace_my_payout_profile()),'verified','creator can read own onboarding state without provider account reference');
select lives_ok($$select public.marketplace_request_payout(1000,'phase3-key-0001')$$,'creator can reserve available payout balance');
select lives_ok($$select public.marketplace_request_payout(1000,'phase3-key-0001')$$,'same idempotency key and amount returns original payout');
select throws_ok($$select public.marketplace_request_payout(900,'phase3-key-0001')$$,'P0001','payout_idempotency_conflict','idempotency key cannot change payout amount');
select throws_ok($$select public.marketplace_request_payout(2500,'phase3-key-0002')$$,'P0001','insufficient_available_balance','reserved funds cannot be requested twice');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('test.phase3_payout_id',(select id::text from public.marketplace_payout_requests where idempotency_key='phase3-key-0001'),true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select lives_ok($$select public.marketplace_create_creator_support_case('payout','Payout review request','Please review the payout request and confirm the transfer status.',current_setting('test.phase3_payout_id')::uuid,'phase3-case-0001')$$,'verified creator can submit a payout support appeal');
select is((select count(*)::integer from public.marketplace_my_creator_support_cases()),1,'support appeal is scoped and persisted for creator');
select lives_ok($$select public.marketplace_create_creator_support_case('payout','Payout review request','Please review the payout request and confirm the transfer status.',current_setting('test.phase3_payout_id')::uuid,'phase3-case-0001')$$,'support case idempotency returns original case');

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is((select count(*)::integer from public.marketplace_payout_requests where creator_id='c2222222-2222-4222-8222-222222222222' and amount_minor=1000),1,'payout request is persisted once');
select throws_ok($$select public.marketplace_review_payout_request((select id from public.marketplace_payout_requests where idempotency_key='phase3-key-0001'),'paid','','mock-transfer')$$,'P0001','invalid_payout_action','finance review RPC cannot mark payout paid');
select lives_ok($$select public.marketplace_review_payout_request((select id from public.marketplace_payout_requests where idempotency_key='phase3-key-0001'),'approve','reviewed','')$$,'finance approval transition is allowed');
select lives_ok($$select public.marketplace_review_payout_request((select id from public.marketplace_payout_requests where idempotency_key='phase3-key-0001'),'processing','batch-started','')$$,'approved payout can enter processing');
select is((select status from public.marketplace_payout_requests where idempotency_key='phase3-key-0001'),'processing','processing payout stays unpaid until settlement reconciliation');
select throws_ok($$select public.marketplace_review_payout_request((select id from public.marketplace_payout_requests where idempotency_key='phase3-key-0001'),'paid','','mock-transfer-phase3')$$,'P0001','invalid_payout_action','finance review RPC cannot mark payout paid');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.marketplace_settle_payout(current_setting('test.phase3_payout_id')::uuid,'mock','transfer-1','settle-event-1',repeat('a',64),'2026-11-05')$$,'42501','permission denied for function marketplace_settle_payout','authenticated creator cannot settle payouts is denied by function grants');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select public.marketplace_settle_payout((select id from public.marketplace_payout_requests where idempotency_key='phase3-key-0001'),'mock','transfer-1','settle-event-1',repeat('a',64),'2026-11-05')$$,'service role settles payout with provider reference');
select is((public.marketplace_settle_payout((select id from public.marketplace_payout_requests where idempotency_key='phase3-key-0001'),'mock','transfer-1','settle-event-1',repeat('a',64),'2026-11-05')->>'status'),'duplicate_settlement','provider settlement retry is idempotent');
select throws_ok($$select public.marketplace_settle_payout((select id from public.marketplace_payout_requests where idempotency_key='phase3-key-0001'),'mock','transfer-conflict','settle-event-2',repeat('b',64),'2026-11-05')$$,'P0001','payout_settlement_conflict','paid payout cannot be reconciled to a different transfer');
select is((select count(*)::integer from public.marketplace_financial_ledger where payout_request_id=(select id from public.marketplace_payout_requests where idempotency_key='phase3-key-0001') and entry_type='payout'),1,'settlement appends exactly one payout ledger debit');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select ok(not has_table_privilege('authenticated','public.marketplace_financial_ledger','SELECT'),'financial ledger remains private to creators');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is((select count(*)::integer from public.marketplace_financial_ledger where payout_request_id=current_setting('test.phase3_payout_id')::uuid and entry_type='payout'),1,'paid payout appends exactly one ledger debit');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select public.marketplace_set_creator_payout_profile('c2222222-2222-4222-8222-222222222222','mock','acct-test','NG','verified','complete',true,1000,null)$$,'service role updates payout onboarding profile');
select lives_ok($$select public.marketplace_generate_creator_statement('c2222222-2222-4222-8222-222222222222','2026-11-01','2026-11-30',now())$$,'service role generates creator statement snapshot');
select is((select creator_earnings_minor from public.marketplace_creator_statements where creator_id='c2222222-2222-4222-8222-222222222222' and period_start='2026-11-01'),3000::bigint,'statement earnings reconcile to ledger');
select is(public.marketplace_generate_creator_statement('c2222222-2222-4222-8222-222222222222','2026-11-01','2026-11-30',now()),(select id from public.marketplace_creator_statements where creator_id='c2222222-2222-4222-8222-222222222222' and period_start='2026-11-01'),'statement generation retry returns immutable snapshot');

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select public.marketplace_apply_subscription_event('mock','sub-event-1',repeat('c',64),'subscription.active','a1111111-1111-4111-8111-111111111111','e4444444-4444-4444-8444-444444444444','f5555555-5555-4555-8555-555555555555','sub-phase3-1','2026-11-01','2026-12-01','2026-11-01')$$,'active subscription event grants entitlement');
select is((select status from public.marketplace_entitlements where subscription_id=(select id from public.marketplace_subscriptions where provider_subscription_id='sub-phase3-1')),'active','subscription event creates active entitlement');
select set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
select is((select active_subscriptions from public.marketplace_my_creator_analytics()),1::bigint,'creator analytics counts active subscriptions from durable records');
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select is((public.marketplace_apply_subscription_event('mock','sub-event-1',repeat('c',64),'subscription.active','a1111111-1111-4111-8111-111111111111','e4444444-4444-4444-8444-444444444444','f5555555-5555-4555-8555-555555555555','sub-phase3-1','2026-11-01','2026-12-01','2026-11-01')->>'status'),'duplicate_event','provider event retry is idempotent');
select throws_ok($$select public.marketplace_apply_subscription_event('mock','sub-event-1',repeat('f',64),'subscription.active','a1111111-1111-4111-8111-111111111111','e4444444-4444-4444-8444-444444444444','f5555555-5555-4555-8555-555555555555','sub-phase3-1','2026-11-01','2026-12-01','2026-11-01')$$,'P0001','subscription_event_payload_conflict','same provider event ID cannot change payload');
select is((public.marketplace_apply_subscription_event('mock','sub-event-2',repeat('d',64),'invoice.payment_failed','a1111111-1111-4111-8111-111111111111','e4444444-4444-4444-8444-444444444444','f5555555-5555-4555-8555-555555555555','sub-phase3-1','2026-11-01','2026-12-01','2026-11-02')->>'status'),'past_due','failed payment enters grace period');
select is((select status from public.marketplace_entitlements where subscription_id=(select id from public.marketplace_subscriptions where provider_subscription_id='sub-phase3-1')),'active','entitlement remains active during bounded grace period');
select is((public.marketplace_apply_subscription_event('mock','sub-event-stale',repeat('a',64),'subscription.renewed','a1111111-1111-4111-8111-111111111111','e4444444-4444-4444-8444-444444444444','f5555555-5555-4555-8555-555555555555','sub-phase3-1','2026-11-01','2026-12-01','2026-11-01T12:00:00Z')->>'status'),'stale_event','out-of-order event cannot roll subscription backwards');
insert into public.marketplace_product_versions(id,product_id,version,artifact_path,artifact_sha256,verification_status,created_by)
values('f6666666-6666-4666-8666-666666666666','e4444444-4444-4444-8444-444444444444','2.0.0','private/phase3-v2.zip',repeat('a',64),'approved','a2222222-2222-4222-8222-222222222222');
update public.marketplace_products set current_version_id='f6666666-6666-4666-8666-666666666666' where id='e4444444-4444-4444-8444-444444444444';
select is((public.marketplace_apply_subscription_event('mock','sub-event-renew',repeat('b',64),'subscription.renewed','a1111111-1111-4111-8111-111111111111','e4444444-4444-4444-8444-444444444444','f5555555-5555-4555-8555-555555555555','sub-phase3-1','2026-12-01','2027-01-01','2026-11-04')->>'status'),'active','existing subscription can renew against its approved pinned version');
select is((select product_version_id from public.marketplace_subscriptions where provider_subscription_id='sub-phase3-1'),'f5555555-5555-4555-8555-555555555555'::uuid,'renewal preserves subscription version pin');

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select public.marketplace_request_subscription_cancellation((select id from public.marketplace_subscriptions where provider_subscription_id='sub-phase3-1'),'cancel-phase3-0001')$$,'buyer identity can request cancellation through durable command');
select is((select cancel_at_period_end from public.marketplace_subscriptions where provider_subscription_id='sub-phase3-1'),true,'cancellation request marks subscription pending period-end cancellation');
select is((public.marketplace_apply_subscription_event('mock','sub-event-3',repeat('e',64),'subscription.cancelled','a1111111-1111-4111-8111-111111111111','e4444444-4444-4444-8444-444444444444','f5555555-5555-4555-8555-555555555555','sub-phase3-1','2026-11-01','2026-12-01','2026-11-05')->>'status'),'cancelled','cancellation event is applied');
select is((select status from public.marketplace_entitlements where subscription_id=(select id from public.marketplace_subscriptions where provider_subscription_id='sub-phase3-1')),'expired','cancelled subscription entitlement expires');

select * from finish();
rollback;
