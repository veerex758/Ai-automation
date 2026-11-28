begin;
select plan(27);

select ok(
  not has_function_privilege('anon','public.get_ai_provider_circuit_state(text)','EXECUTE'),
  'anonymous clients cannot read shared provider circuits'
);
select ok(
  not has_function_privilege('authenticated','public.get_ai_provider_circuit_state(text)','EXECUTE'),
  'authenticated clients cannot read shared provider circuits'
);
select ok(
  has_function_privilege('service_role','public.get_ai_provider_circuit_state(text)','EXECUTE'),
  'service role can read shared provider circuits'
);
select ok(
  not has_table_privilege('service_role','private.ai_provider_circuit_breakers','SELECT'),
  'service role cannot read circuit records directly'
);
select ok(
  not has_table_privilege('service_role','private.ai_provider_circuit_events','SELECT'),
  'service role cannot read circuit event history directly'
);

delete from private.ai_provider_circuit_events;
delete from private.ai_provider_circuit_breakers;
insert into private.ai_provider_circuit_breakers(provider)
values ('gemini'), ('groq'), ('cloudflare');

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

select is(
  public.get_ai_provider_circuit_state('gemini')->>'state',
  'closed',
  'Gemini starts with its own closed circuit'
);
select is(
  public.get_ai_provider_circuit_state('groq')->>'state',
  'closed',
  'Groq starts with an independent closed circuit'
);
select is(
  public.get_ai_provider_circuit_state('cloudflare')->>'state',
  'closed',
  'Cloudflare starts with an independent closed circuit'
);

select is(
  public.record_ai_provider_circuit_result('gemini',false,503,0,false,3,0.5,5,300,30000,300000,300000)->>'state',
  'closed',
  'one transient failure does not open the circuit'
);
select is(
  public.record_ai_provider_circuit_result('gemini',false,503,0,false,3,0.5,5,300,30000,300000,300000)->>'state',
  'closed',
  'two transient failures remain below the configured threshold'
);
select is(
  public.record_ai_provider_circuit_result('gemini',false,503,0,false,3,0.5,5,300,1000,1000,1000)->>'state',
  'open',
  'three consecutive failures open Gemini circuit'
);
select ok(
  not (public.get_ai_provider_circuit_state('gemini')->>'allowed')::boolean,
  'open Gemini circuit temporarily bypasses normal requests'
);
select is(
  public.get_ai_provider_circuit_state('groq')->>'state',
  'closed',
  'Gemini failure does not open or alter Groq circuit'
);

-- A separate provider opens on the rolling failure-rate threshold even when
-- its consecutive-failure threshold has deliberately been set higher.
select public.record_ai_provider_circuit_result('groq',false,503,0,false,20,0.5,5,300,30000,300000,300000);
select public.record_ai_provider_circuit_result('groq',true,null,0,false,20,0.5,5,300,30000,300000,300000);
select public.record_ai_provider_circuit_result('groq',false,502,0,false,20,0.5,5,300,30000,300000,300000);
select public.record_ai_provider_circuit_result('groq',true,null,0,false,20,0.5,5,300,30000,300000,300000);
select is(
  public.record_ai_provider_circuit_result('groq',false,504,0,false,20,0.5,5,300,30000,300000,300000)->>'state',
  'open',
  'recent failure rate of three in five attempts opens Groq circuit'
);
select ok(
  (public.get_ai_provider_circuit_state('groq')->>'recentFailureRate')::numeric >= 0.6,
  'circuit records the rolling provider failure rate'
);
select is(
  public.get_ai_provider_circuit_state('cloudflare')->>'state',
  'closed',
  'Groq failure-rate circuit remains isolated from Cloudflare'
);

-- Authentication failures and rate limits open immediately, with bounded
-- provider-specific cooldowns.
select is(
  public.record_ai_provider_circuit_result('cloudflare',false,401,0,false)->>'state',
  'open',
  'provider authentication failure opens only that provider circuit'
);
select ok(
  (public.get_ai_provider_circuit_state('cloudflare')->>'retryAfterMs')::bigint between 240000 and 360000,
  'authentication cooldown uses the configured five-minute default'
);

select is(
  public.record_ai_provider_circuit_result('groq',false,429,45000,false)->>'state',
  'open',
  '429 rate limit opens the provider circuit immediately'
);
select ok(
  (public.get_ai_provider_circuit_state('groq')->>'retryAfterMs')::bigint between 40000 and 50000,
  '429 cooldown honors Retry-After'
);
-- The deliberately short test cooldown expires without direct table access.
select pg_sleep(1.1);

-- Prove a single atomic half-open probe lease.
create temporary table gemini_probe_admission as
select public.get_ai_provider_circuit_state('gemini') as result;
select is(
  (select result->>'state' from gemini_probe_admission),
  'half_open',
  'expired circuit enters half-open state'
);
select ok(
  (select (result->>'allowed')::boolean and (result->>'probe')::boolean from gemini_probe_admission),
  'first half-open caller obtains the one health probe lease'
);
select ok(
  not (public.get_ai_provider_circuit_state('gemini')->>'allowed')::boolean,
  'concurrent caller is bypassed while the probe lease is held'
);
select is(
  public.record_ai_provider_circuit_result('gemini',true,null,0,true)->>'state',
  'closed',
  'successful health probe closes the circuit'
);

-- A failed authentication check opens a short cooldown, then a probe may run.
select public.record_ai_provider_circuit_result('gemini',false,401,0,false,3,0.5,5,300,1000,1000,1000);
select pg_sleep(1.1);
create temporary table gemini_failed_probe as
select public.get_ai_provider_circuit_state('gemini') as result;
select ok(
  (select (result->>'probe')::boolean from gemini_failed_probe),
  'expired circuit permits a new probe after the previous lease'
);
select is(
  public.record_ai_provider_circuit_result('gemini',false,503,0,true)->>'state',
  'open',
  'failed health probe reopens the circuit'
);

-- A late ordinary success cannot erase the open circuit left by a failed probe.
select is(
  public.record_ai_provider_circuit_result('gemini',true,null,0,false)->>'state',
  'open',
  'late success from ordinary request cannot close an open circuit'
);

reset role;
select * from finish();
rollback;
