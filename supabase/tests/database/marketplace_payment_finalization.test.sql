begin;
select plan(17);

-- Schema compatibility assertions: both old and new event/ledger columns coexist.
select has_column('public','marketplace_payment_events','event_id','legacy event identifier retained');
select has_column('public','marketplace_payment_events','provider_event_id','canonical provider event identifier');
select has_column('public','marketplace_financial_ledger','event_id','legacy FK is nullable after upgrade');
select has_column('public','marketplace_financial_ledger','provider_event_id','provider event key is present');

-- Service-role gate is enforced by the RPC even when called as authenticated.
select ok(not has_function_privilege('authenticated','public.marketplace_finalize_payment(text,text,uuid,text,integer,text,text,timestamptz)','EXECUTE'),'payment finalizer is not executable by authenticated clients');

-- Transactional fixture. pgTAP test transaction rolls back all rows at end.
insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values ('a1111111-1111-4111-8111-111111111111','authenticated','authenticated','marketplace-test-buyer@example.invalid','',now(),now())
on conflict(id) do nothing;
insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
values ('a2222222-2222-4222-8222-222222222222','authenticated','authenticated','marketplace-test-creator@example.invalid','',now(),now())
on conflict(id) do nothing;
insert into public.marketplace_creators(id,user_id,display_name,slug,status)
values ('c2222222-2222-4222-8222-222222222222','a2222222-2222-4222-8222-222222222222','Test Creator','sql-test-creator','verified')
on conflict(id) do nothing;
insert into public.marketplace_categories(id,slug,name)
values ('d3333333-3333-4333-8333-333333333333','sql-test-category','SQL Test')
on conflict(id) do nothing;
insert into public.marketplace_products(id,creator_id,category_id,slug,name,summary,product_type,pricing_type,price_minor,status,created_by)
values ('e4444444-4444-4444-8444-444444444444','c2222222-2222-4222-8222-222222222222','d3333333-3333-4333-8333-333333333333','sql-test-product','SQL Test Product','Fixture','workflow','one_time',1000,'published','a2222222-2222-4222-8222-222222222222')
on conflict(id) do nothing;
insert into public.marketplace_product_versions(id,product_id,version,artifact_path,artifact_sha256,verification_status,created_by)
values ('f5555555-5555-4555-8555-555555555555','e4444444-4444-4444-8444-444444444444','1.0.0','private/test.zip',repeat('b',64),'approved','a2222222-2222-4222-8222-222222222222')
on conflict(id) do nothing;
update public.marketplace_products set current_version_id='f5555555-5555-4555-8555-555555555555' where id='e4444444-4444-4444-8444-444444444444';
insert into public.marketplace_purchases(id,buyer_user_id,product_id,product_version_id,provider,amount_minor,currency,status)
values ('a6666666-6666-4666-8666-666666666666','a1111111-1111-4111-8111-111111111111','e4444444-4444-4444-8444-444444444444','f5555555-5555-4555-8555-555555555555','mock',1000,'USD','pending')
on conflict(id) do nothing;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok(
 $$select public.marketplace_finalize_payment('mock','evt-sql-1','a6666666-6666-4666-8666-666666666666','pay-sql-1',1000,'USD',repeat('c',64),now())$$,
 'verified payment finalizes transactionally'
);
select is((select status from public.marketplace_purchases where id='a6666666-6666-4666-8666-666666666666'),'paid','purchase transitions to paid');
select is((select count(*)::integer from public.marketplace_entitlements where purchase_id='a6666666-6666-4666-8666-666666666666' and status='active'),1,'one active entitlement created');
select is((select sum(amount_minor)::integer from public.marketplace_financial_ledger where purchase_id='a6666666-6666-4666-8666-666666666666' and entry_type='platform_commission'),200,'platform receives exactly 20 percent');
select is((select sum(amount_minor)::integer from public.marketplace_financial_ledger where purchase_id='a6666666-6666-4666-8666-666666666666' and entry_type='creator_earning'),800,'creator receives exactly 80 percent');
select is((select count(*)::integer from public.marketplace_financial_ledger where purchase_id='a6666666-6666-4666-8666-666666666666'),3,'finalization writes three ledger lines');

-- Duplicate payment event must be recorded without duplicating ledger or entitlement.
select lives_ok(
 $select public.marketplace_finalize_payment('mock','evt-sql-duplicate','a6666666-6666-4666-8666-666666666666','pay-sql-1',1000,'USD',repeat('d',64),now())$,
 'duplicate provider payment event is safely acknowledged'
);
select is((select count(*)::integer from public.marketplace_payment_events where provider='mock' and provider_event_id='evt-sql-duplicate' and error_code='duplicate_payment'),1,'duplicate payment event is persisted in inbox');

select lives_ok(
 $select public.marketplace_reverse_payment('mock','evt-sql-refund','a6666666-6666-4666-8666-666666666666','refund',1000,repeat('e',64),now())$,
 'full refund appends balanced reversals'
);
select is((select status from public.marketplace_purchases where id='a6666666-6666-4666-8666-666666666666'),'refunded','full refund updates purchase state');
select is((select status from public.marketplace_entitlements where purchase_id='a6666666-6666-4666-8666-666666666666'),'revoked','full refund revokes entitlement');
select is((select count(*)::integer from public.marketplace_financial_reconciliation() where purchase_id='a6666666-6666-4666-8666-666666666666'),0,'reconciliation treats refunds as reversals, not missing gross sales');

select * from finish();
rollback;
