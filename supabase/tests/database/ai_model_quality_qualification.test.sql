begin;
select plan(14);

select ok(
  (select c.relrowsecurity from pg_class c
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='private' and c.relname='ai_model_qualifications'),
  'model qualification table has row-level security enabled'
);
select ok(
  not has_table_privilege('service_role','private.ai_model_qualifications','SELECT'),
  'service role cannot read qualification rows directly'
);
select ok(
  not has_function_privilege('anon','public.record_ai_model_evaluation(jsonb)','EXECUTE'),
  'anonymous clients cannot write model qualifications'
);
select ok(
  not has_function_privilege('authenticated','public.record_ai_model_evaluation(jsonb)','EXECUTE'),
  'authenticated clients cannot write model qualifications'
);
select ok(
  has_function_privilege('service_role','public.record_ai_model_evaluation(jsonb)','EXECUTE'),
  'service role can write model qualifications through the RPC'
);
select ok(
  not has_function_privilege('anon','public.list_eligible_ai_models(text,text)','EXECUTE'),
  'anonymous clients cannot enumerate model qualifications'
);
select ok(
  not has_function_privilege('authenticated','public.list_eligible_ai_models(text,text)','EXECUTE'),
  'authenticated clients cannot enumerate model qualifications'
);
select ok(
  has_function_privilege('service_role','public.list_eligible_ai_models(text,text)','EXECUTE'),
  'service role can list eligible models through the RPC'
);

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

select is(
  public.record_ai_model_evaluation(jsonb_build_object(
    'provider','gemini',
    'model','benchmark-test-model',
    'task','summarization',
    'benchmarkVersion','rexnora-quality-v2',
    'datasetSha256',repeat('a',64),
    'sampleCount',20,
    'recoverySampleCount',4,
    'metrics',jsonb_build_object(
      'schemaValidRate',null,
      'workflowGraphCorrectness',null,
      'toolCallAccuracy',null,
      'taskAccuracy',0.95,
      'p95LatencyMs',1200,
      'costPerSuccessfulOperationUsd',0.001,
      'recoveryRate',1,
      'successfulOperations',19
    ),
    'thresholds',jsonb_build_object(
      'minimumSamples',20,
      'minimumRecoverySamples',3,
      'minimumTaskAccuracy',0.9,
      'maximumP95LatencyMs',8000,
      'maximumCostPerSuccessfulOperationUsd',0.01,
      'minimumRecoveryRate',0.75
    )
  ))->>'eligible',
  'true',
  'a valid benchmark meeting summarization thresholds is qualified'
);

select is(
  (select count(*)::int
   from public.list_eligible_ai_models('summarization','rexnora-quality-v2') as q(qualification)
   where q.qualification->>'model'='benchmark-test-model'),
  1,
  'qualified model is returned for the exact task and benchmark version'
);
select is(
  (select count(*)::int
   from public.list_eligible_ai_models('lead_qualification','rexnora-quality-v2') as q(qualification)
   where q.qualification->>'model'='benchmark-test-model'),
  0,
  'qualification is not reused for another task'
);
select is(
  (select count(*)::int
   from public.list_eligible_ai_models('summarization','rexnora-quality-v1') as q(qualification)
   where q.qualification->>'model'='benchmark-test-model'),
  0,
  'qualification is not reused across benchmark versions'
);

select is(
  public.record_ai_model_evaluation(jsonb_build_object(
    'provider','gemini',
    'model','benchmark-test-model',
    'task','summarization',
    'benchmarkVersion','rexnora-quality-v2',
    'datasetSha256',repeat('b',64),
    'sampleCount',20,
    'recoverySampleCount',4,
    'metrics',jsonb_build_object(
      'schemaValidRate',null,
      'workflowGraphCorrectness',null,
      'toolCallAccuracy',null,
      'taskAccuracy',0.5,
      'p95LatencyMs',1200,
      'costPerSuccessfulOperationUsd',0.001,
      'recoveryRate',1,
      'successfulOperations',10
    ),
    'thresholds',jsonb_build_object(
      'minimumSamples',20,
      'minimumRecoverySamples',3,
      'minimumTaskAccuracy',0.9,
      'maximumP95LatencyMs',8000,
      'maximumCostPerSuccessfulOperationUsd',0.01,
      'minimumRecoveryRate',0.75
    )
  ))->>'eligible',
  'false',
  'a below-threshold re-evaluation downgrades an existing model'
);
select is(
  (select count(*)::int
   from public.list_eligible_ai_models('summarization','rexnora-quality-v2') as q(qualification)
   where q.qualification->>'model'='benchmark-test-model'),
  0,
  'downgraded model is removed from eligible routing results'
);

reset role;
select * from finish();
rollback;
