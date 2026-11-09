begin;
select plan(4);
select has_function('public','marketplace_installation_lifecycle','installation lifecycle is server-controlled');
select ok(not has_function_privilege('anon','public.marketplace_installation_lifecycle(uuid,uuid,text,jsonb)','EXECUTE'),'anonymous cannot transition installations');
select ok(not has_function_privilege('authenticated','public.marketplace_installation_lifecycle(uuid,uuid,text,jsonb)','EXECUTE'),'authenticated cannot bypass dry-run lifecycle RPC');
select ok(has_function_privilege('service_role','public.marketplace_installation_lifecycle(uuid,uuid,text,jsonb)','EXECUTE'),'server can transition verified installations');
select * from finish();
rollback;
