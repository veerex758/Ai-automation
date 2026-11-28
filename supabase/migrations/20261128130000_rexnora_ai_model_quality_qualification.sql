create schema if not exists private;
create table if not exists private.ai_model_qualifications(
 provider text not null check(provider in ('gemini','groq','cloudflare')),
 model text not null, task text not null check(task in ('workflow_generation','workflow_schema_repair','workflow_debugging','lead_qualification','email_drafting','data_extraction','summarization','agent_tool_calling')),
 benchmark_version text not null, dataset_sha256 text not null check(length(dataset_sha256)=64),
 sample_count integer not null check(sample_count>=0), recovery_sample_count integer not null check(recovery_sample_count>=0),
 metrics jsonb not null, thresholds jsonb not null, eligible boolean not null default false,
 reasons jsonb not null default '[]'::jsonb, evaluated_at timestamptz not null default now(),
 primary key(provider,model,task,benchmark_version)
);
alter table private.ai_model_qualifications enable row level security;
revoke all on private.ai_model_qualifications from public,anon,authenticated;
grant select,insert,update on private.ai_model_qualifications to service_role;
create or replace function public.record_ai_model_evaluation(p_evaluation jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare v jsonb:=p_evaluation; m jsonb:=v->'metrics'; t jsonb:=v->'thresholds'; reasons jsonb:='[]'::jsonb; ok boolean;
begin
 if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 if jsonb_typeof(v)<>'object' or length(coalesce(v->>'datasetSha256',''))<>64 then raise exception 'invalid evaluation'; end if;
 if (v->>'sampleCount')::int < coalesce((t->>'minimumSamples')::int,20) then reasons:=reasons||'["insufficient_samples"]'::jsonb; end if;
 if (v->>'recoverySampleCount')::int < coalesce((t->>'minimumRecoverySamples')::int,3) then reasons:=reasons||'["insufficient_recovery_samples"]'::jsonb; end if;
 if coalesce((m->>'taskAccuracy')::numeric,0)<coalesce((t->>'minimumTaskAccuracy')::numeric,1) then reasons:=reasons||'["task_accuracy_below_threshold"]'::jsonb; end if;
 if t?'minimumSchemaValidRate' and coalesce((m->>'schemaValidRate')::numeric,-1)<(t->>'minimumSchemaValidRate')::numeric then reasons:=reasons||'["schema_validity_below_threshold"]'::jsonb; end if;
 if t?'minimumWorkflowGraphCorrectness' and coalesce((m->>'workflowGraphCorrectness')::numeric,-1)<(t->>'minimumWorkflowGraphCorrectness')::numeric then reasons:=reasons||'["graph_correctness_below_threshold"]'::jsonb; end if;
 if t?'minimumToolCallAccuracy' and coalesce((m->>'toolCallAccuracy')::numeric,-1)<(t->>'minimumToolCallAccuracy')::numeric then reasons:=reasons||'["tool_call_accuracy_below_threshold"]'::jsonb; end if;
 if coalesce((m->>'p95LatencyMs')::numeric,1e18)>(t->>'maximumP95LatencyMs')::numeric then reasons:=reasons||'["latency_above_threshold"]'::jsonb; end if;
 if coalesce((m->>'costPerSuccessfulOperationUsd')::numeric,1e18)>(t->>'maximumCostPerSuccessfulOperationUsd')::numeric then reasons:=reasons||'["cost_above_threshold"]'::jsonb; end if;
 if coalesce((m->>'recoveryRate')::numeric,0)<(t->>'minimumRecoveryRate')::numeric then reasons:=reasons||'["recovery_rate_below_threshold"]'::jsonb; end if;
 ok:=jsonb_array_length(reasons)=0;
 insert into private.ai_model_qualifications(provider,model,task,benchmark_version,dataset_sha256,sample_count,recovery_sample_count,metrics,thresholds,eligible,reasons)
 values(v->>'provider',v->>'model',v->>'task',v->>'benchmarkVersion',v->>'datasetSha256',(v->>'sampleCount')::int,(v->>'recoverySampleCount')::int,m,t,ok,reasons)
 on conflict(provider,model,task,benchmark_version) do update set dataset_sha256=excluded.dataset_sha256,sample_count=excluded.sample_count,recovery_sample_count=excluded.recovery_sample_count,metrics=excluded.metrics,thresholds=excluded.thresholds,eligible=excluded.eligible,reasons=excluded.reasons,evaluated_at=now();
 return jsonb_build_object('eligible',ok,'reasons',reasons);
end $$;
create or replace function public.list_eligible_ai_models(p_task text,p_benchmark_version text)
returns setof jsonb language sql stable security definer set search_path=pg_catalog,private as $$
 select jsonb_build_object('provider',provider,'model',model,'task',task,'benchmarkVersion',benchmark_version,'datasetSha256',dataset_sha256,'sampleCount',sample_count,'recoverySampleCount',recovery_sample_count,'metrics',metrics,'thresholds',thresholds,'eligible',eligible,'evaluatedAt',evaluated_at)
 from private.ai_model_qualifications where eligible and task=p_task and benchmark_version=p_benchmark_version;
$$;
revoke all on function public.record_ai_model_evaluation(jsonb) from public,anon,authenticated;
revoke all on function public.list_eligible_ai_models(text,text) from public,anon,authenticated;
grant execute on function public.record_ai_model_evaluation(jsonb) to service_role;
grant execute on function public.list_eligible_ai_models(text,text) to service_role;
