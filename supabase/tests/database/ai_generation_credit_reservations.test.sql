begin;
select plan(42);

select has_table('private','ai_generation_credit_reservations','logical AI credit reservation table exists');
select has_table('private','ai_provider_usage_events','provider token/cost telemetry is stored separately');
select ok((select relrowsecurity from pg_class where oid='private.ai_generation_credit_reservations'::regclass),'reservation table has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='private.ai_provider_usage_events'::regclass),'provider usage table has RLS enabled');
select ok(not has_table_privilege('authenticated','private.ai_generation_credit_reservations','SELECT'),'browser users cannot inspect reservation rows');
select ok(not has_table_privilege('authenticated','private.ai_provider_usage_events','SELECT'),'browser users cannot read provider telemetry rows');
select ok(not has_function_privilege('anon','public.reserve_ai_generation_usage(uuid,uuid,text)','EXECUTE'),'anonymous users cannot reserve AI credits');
select ok(not has_function_privilege('anon','public.release_ai_generation_usage(uuid,uuid,text,jsonb)','EXECUTE'),'anonymous users cannot release AI credits');
select ok(has_function_privilege('authenticated','public.release_ai_generation_usage(uuid,uuid,text,jsonb)','EXECUTE'),'authenticated workspace members can release their own reservations');
select ok(not has_function_privilege('anon','public.consume_ai_generation_usage(uuid,uuid,jsonb)','EXECUTE'),'anonymous users cannot settle AI credits');
select ok(has_function_privilege('authenticated','public.reserve_ai_generation_usage(uuid,uuid,text)','EXECUTE'),'authenticated workspace members can reserve through the RPC');
select ok(has_function_privilege('authenticated','public.consume_ai_generation_usage(uuid,uuid,jsonb)','EXECUTE'),'authenticated workspace members can settle validated generations through the RPC');

-- One user, two independent workspaces, and a second workspace with only one
-- unconsumed AI credit left. All fixtures are rolled back at the end.
insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('a5511111-1111-4111-8111-111111111111','authenticated','authenticated','phase5-owner@example.invalid','',now(),now()),
  ('a5522222-2222-4222-8222-222222222222','authenticated','authenticated','phase5-member@example.invalid','',now(),now())
on conflict(id) do nothing;

insert into public.workspaces(id,name,owner_id) values
  ('b5511111-1111-4111-8111-111111111111','Phase 5 Reservation Workspace','a5511111-1111-4111-8111-111111111111'),
  ('b5522222-2222-4222-8222-222222222222','Phase 5 Quota Guard Workspace','a5511111-1111-4111-8111-111111111111')
on conflict(id) do nothing;

insert into public.workspace_members(workspace_id,user_id,role) values
  ('b5511111-1111-4111-8111-111111111111','a5522222-2222-4222-8222-222222222222','member')
on conflict(workspace_id,user_id) do update set role='member';

insert into public.workspace_subscriptions(workspace_id,plan_key,status) values
  ('b5511111-1111-4111-8111-111111111111','free','active'),
  ('b5522222-2222-4222-8222-222222222222','free','active')
on conflict(workspace_id) do update set plan_key='free',status='active';

insert into public.workspace_usage(workspace_id,metric,quantity,period_start,actor_user_id,metadata)
select 'b5522222-2222-4222-8222-222222222222'::uuid, metric, 1, date_trunc('month',now())::date,
       'a5511111-1111-4111-8111-111111111111'::uuid, jsonb_build_object('fixture', metric, 'sequence', n)
from generate_series(1,24) n
cross join (values ('ai_credit'),('ai_generation')) as metrics(metric);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a5511111-1111-4111-8111-111111111111","role":"authenticated"}',true);

select is(
  public.reserve_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    repeat('a',64)
  )->>'allowed',
  'true',
  'one logical operation reserves exactly one generation slot and AI credit'
);
select is(
  (select count(*)::integer from public.workspace_usage
   where workspace_id='b5511111-1111-4111-8111-111111111111'),
  0,
  'reservation does not create customer usage or charge a credit'
);
select is(
  public.reserve_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    repeat('a',64)
  )->>'reason',
  'operation_in_progress',
  'a duplicate logical request cannot create another reservation or provider run'
);
select throws_ok(
  $select public.reserve_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    repeat('b',64)
  )$,
  '22023',
  'idempotency key reused with different AI operation input',
  'a logical operation ID cannot be reused with different request content'
);
select set_config('request.jwt.claims','{"sub":"a5522222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select throws_ok(
  $select public.reserve_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    repeat('a',64)
  )$,
  '42501',
  'AI operation belongs to another user',
  'another workspace member cannot take over another user's active operation ID'
);
select throws_ok(
  $select public.release_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    'cross_user_release'
  )$,
  '42501',
  'AI operation belongs to another user',
  'another workspace member cannot release someone else reservation'
);
select throws_ok(
  $select public.consume_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    '[]'::jsonb
  )$,
  '42501',
  'AI operation belongs to another user',
  'another workspace member cannot settle someone else reservation'
);
select set_config('request.jwt.claims','{"sub":"a5511111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is(
  public.release_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    'provider_exhausted'
  )->>'released',
  'true',
  'all-provider failure releases the hold without creating usage rows'
);
select is(
  public.release_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    'provider_exhausted'
  )->>'duplicate',
  'true',
  'releasing the same failed operation twice is idempotent'
);
select is(
  public.reserve_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    repeat('a',64)
  )->>'allowed',
  'true',
  'a released logical operation can retry with the same ID and request fingerprint'
);
select is(
  public.consume_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    jsonb_build_array(
      jsonb_build_object('provider','gemini','model','gemini-3.8-flash','inputTokens',10,'outputTokens',20,'totalTokens',30,'fallbackUsed',false),
      jsonb_build_object('provider','groq','model','openai/gpt-oss-120b','inputTokens',12,'outputTokens',18,'totalTokens',30,'providerCostUsd',0.0002,'fallbackUsed',true)
    )
  )->>'allowed',
  'true',
  'validated generation consumes one credit once and records both actual provider attempts'
);
select is(
  (select count(*)::integer from public.workspace_usage
   where workspace_id='b5511111-1111-4111-8111-111111111111' and metric='ai_credit'),
  1,
  'Gemini-to-Groq fallback still creates exactly one customer AI credit usage row'
);
select is(
  (select count(*)::integer from public.workspace_usage
   where workspace_id='b5511111-1111-4111-8111-111111111111' and metric='ai_generation'),
  1,
  'one logical generation creates exactly one generation usage row'
);

reset role;
select is(
  (select count(*)::integer from private.ai_provider_usage_events
   where workspace_id='b5511111-1111-4111-8111-111111111111'
     and operation_id='c5511111-1111-4111-8111-111111111111'),
  2,
  'provider usage table records per-provider input/output tokens separately from billing'
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a5511111-1111-4111-8111-111111111111","role":"authenticated"}',true);

select is(
  public.consume_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    '[]'::jsonb
  )->>'duplicate',
  'true',
  'repeated settlement for a consumed logical operation is idempotent'
);
select is(
  (select count(*)::integer from public.workspace_usage
   where workspace_id='b5511111-1111-4111-8111-111111111111' and metric='ai_credit'),
  1,
  'repeated settlement does not create a second customer charge'
);
select is(
  public.release_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5511111-1111-4111-8111-111111111111',
    'late_cleanup'
  )->>'reason',
  'already_consumed',
  'late cleanup cannot refund or reverse an already consumed generation'
);

select is(
  public.reserve_ai_generation_usage(
    'b5522222-2222-4222-8222-222222222222',
    'c5522222-2222-4222-8222-222222222222',
    repeat('c',64)
  )->>'allowed',
  'true',
  'a workspace with one remaining AI credit can reserve that final slot'
);
select is(
  public.consume_workspace_usage(
    'b5522222-2222-4222-8222-222222222222',
    'ai_credit',
    1,
    '{"feature":"parallel_generic_spend"}'::jsonb
  )->>'allowed',
  'false',
  'generic usage metering cannot spend a credit held by an AI generation'
);
select is(
  public.consume_agent_run_usage(
    'b5522222-2222-4222-8222-222222222222',
    'd5522222-2222-4222-8222-222222222222',
    'phase5-agent-key-0001'
  )->>'allowed',
  'false',
  'agent metering cannot spend a credit held by an AI generation'
);
select is(
  public.release_ai_generation_usage(
    'b5522222-2222-4222-8222-222222222222',
    'c5522222-2222-4222-8222-222222222222',
    'validation_failed'
  )->>'released',
  'true',
  'validation failure releases the pending hold'
);
select is(
  (select count(*)::integer from public.workspace_usage
   where workspace_id='b5522222-2222-4222-8222-222222222222' and metric='ai_credit'),
  24,
  'releasing the hold leaves customer credit usage unchanged'
);
select is(
  public.consume_workspace_usage(
    'b5522222-2222-4222-8222-222222222222',
    'ai_credit',
    1,
    '{"feature":"spend_after_release"}'::jsonb
  )->>'allowed',
  'true',
  'the released credit becomes available to the next authorized operation'
);

select is(
  public.reserve_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5533333-3333-4333-8333-333333333333',
    repeat('d',64)
  )->>'allowed',
  'true',
  'a later logical operation can reserve an independent slot'
);
select is(
  public.release_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5533333-3333-4333-8333-333333333333',
    'invalid_output',
    jsonb_build_array(
      jsonb_build_object('provider','gemini','model','gemini-3.8-flash','inputTokens',7,'outputTokens',9,'totalTokens',16,'fallbackUsed',false)
    )
  )->>'provider_usage_records',
  '1',
  'invalid output releases customer quota but persists actual provider token usage'
);
select is(
  (select count(*)::integer from public.workspace_usage
   where workspace_id='b5511111-1111-4111-8111-111111111111' and metric='ai_credit'),
  1,
  'invalid output does not create a second customer credit charge'
);
reset role;
select is(
  (select count(*)::integer from private.ai_provider_usage_events
   where workspace_id='b5511111-1111-4111-8111-111111111111'
     and operation_id='c5533333-3333-4333-8333-333333333333'
     and provider='gemini' and input_tokens=7 and output_tokens=9),
  1,
  'provider cost ledger keeps invalid-output usage separate from customer billing'
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a5511111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is(
  public.reserve_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5544444-4444-4444-8444-444444444444',
    repeat('e',64)
  )->>'allowed',
  'true',
  'a generation can reserve in the current quota month'
);
reset role;
update private.ai_generation_credit_reservations
set period_start = (date_trunc('month',now()) - interval '1 month')::date
where workspace_id='b5511111-1111-4111-8111-111111111111'
  and operation_id='c5544444-4444-4444-8444-444444444444';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a5511111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is(
  public.consume_ai_generation_usage(
    'b5511111-1111-4111-8111-111111111111',
    'c5544444-4444-4444-8444-444444444444',
    '[]'::jsonb
  )->>'allowed',
  'true',
  'a reserved operation can settle after the quota month changes'
);
reset role;
select is(
  (select period_start from public.workspace_usage
   where workspace_id='b5511111-1111-4111-8111-111111111111'
     and metric='ai_credit'
     and metadata->>'operation_id'='c5544444-4444-4444-8444-444444444444'),
  (date_trunc('month',now()) - interval '1 month')::date,
  'settlement is posted to the same quota month that authorized the reservation'
);

select * from finish();
rollback;
