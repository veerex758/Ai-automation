begin;
select plan(18);

-- The circuit breaker is global service state, never browser-readable.
select ok(
  not has_function_privilege('anon','public.get_ai_provider_circuit_state(text)','EXECUTE'),
  'anonymous clients cannot read the Gemini circuit'
);
select ok(
  not has_function_privilege('authenticated','public.get_ai_provider_circuit_state(text)','EXECUTE'),
  'authenticated clients cannot read the Gemini circuit'
);
select ok(
  has_function_privilege('service_role','public.get_ai_provider_circuit_state(text)','EXECUTE'),
  'server service role can read the Gemini circuit'
);
select ok(
  not has_table_privilege('service_role','private.ai_provider_circuit_breakers','SELECT'),
  'service role cannot read circuit storage directly'
);

delete from private.ai_provider_circuit_breakers where provider='gemini';

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

select is(
  public.get_ai_provider_circuit_state('gemini')->>'state',
  'closed',
  'new provider circuit starts closed'
);
select is(
  public.record_ai_provider_circuit_result('gemini',false,503,0,false)->>'state',
  'closed',
  'one transient provider failure is recorded without opening the circuit'
);
select is(
  public.record_ai_provider_circuit_result('gemini',false,503,0,false,2,0.5,5,300,30000,300000,300000)->>'state',
  'open',
  'configured two-failure threshold opens the circuit'
);
select ok(
  not (public.get_ai_provider_circuit_state('gemini')->>'allowed')::boolean,
  'open circuit blocks another provider request'
);
select ok(
  (public.get_ai_provider_circuit_state('gemini')->>'retryAfterMs')::bigint > 0,
  'open circuit returns a positive retry delay'
);

select is(
  public.record_ai_provider_circuit_result('gemini',false,429,45000,false)->>'state',
  'open',
  'a rate-limit response opens the circuit immediately'
);
select ok(
  (public.get_ai_provider_circuit_state('gemini')->>'retryAfterMs')::bigint between 40000 and 50000,
  '429 cooldown respects the provider retry-after window'
);
reset role;

-- Expire the cooldown and prove that exactly one half-open probe is leased.
update private.ai_provider_circuit_breakers
set open_until=clock_timestamp() - interval '1 second', probe_until=null
where provider='gemini';

set local role service_role;
create temporary table gemini_probe_result as
select public.get_ai_provider_circuit_state('gemini') as result;
select is(
  (select result->>'state' from gemini_probe_result),
  'half_open',
  'expired circuit enters half-open state for a probe'
);
select ok(
  (select (result->>'allowed')::boolean from gemini_probe_result),
  'first half-open caller receives the probe lease'
);
select ok(
  not (public.get_ai_provider_circuit_state('gemini')->>'allowed')::boolean,
  'concurrent half-open caller is blocked while the probe lease is active'
);
select is(
  public.record_ai_provider_circuit_result('gemini',true,null,0,true)->>'state',
  'closed',
  'successful half-open probe closes the circuit'
);
select is(
  public.get_ai_provider_circuit_state('gemini')->>'state',
  'closed',
  'subsequent requests proceed after successful probe'
);

-- A late response from a request that started before the open transition
-- must not clear a newer cooldown.
reset role;
update private.ai_provider_circuit_breakers
set consecutive_failures=2,open_until=clock_timestamp() + interval '1 minute',probe_until=null
where provider='gemini';
set local role service_role;
select is(
  public.record_ai_provider_circuit_result('gemini',true,null,0,false)->>'state',
  'open',
  'late success cannot close an already-open circuit'
);

select * from finish();
rollback;
