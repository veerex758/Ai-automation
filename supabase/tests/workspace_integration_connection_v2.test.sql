begin;
select plan(6);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ca111111-1111-4111-8111-111111111111','authenticated','authenticated','connection-v2-owner@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
insert into public.workspaces(id,name,owner_id)
values('cb111111-1111-4111-8111-111111111111','Connection v2 test workspace','ca111111-1111-4111-8111-111111111111');
select ok(has_function_privilege('service_role','public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid,boolean)','EXECUTE'),'backend can execute v2 RPC');
select ok(not has_function_privilege('authenticated','public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid,boolean)','EXECUTE'),'browser cannot execute v2 RPC');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select public.save_workspace_integration_connection(
'cb111111-1111-4111-8111-111111111111','resend','Resend connection v2',
'v2.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.Q2lwaGVydGV4dEE',
'ca111111-1111-4111-8111-111111111111','cc111111-1111-4111-8111-111111111111',true
)$$,'backend can create connection with predetermined UUID');
select is((select encryption_version from public.workspace_integration_secrets where integration_id='cc111111-1111-4111-8111-111111111111'),'v2','database stores v2 version');
select lives_ok($$select public.save_workspace_integration_connection(
'cb111111-1111-4111-8111-111111111111','resend','Resend connection v2 updated',
'v2.BBBBBBBBBBBBBBBB.BBBBBBBBBBBBBBBBBBBBBB.VXBkYXRlZENyZWRlbnRpYWw',
'ca111111-1111-4111-8111-111111111111','cc111111-1111-4111-8111-111111111111',false
)$$,'backend can update selected connection');
select is((select display_name from public.workspace_integrations where id='cc111111-1111-4111-8111-111111111111' and workspace_id='cb111111-1111-4111-8111-111111111111'),'Resend connection v2 updated','update changes selected connection');
select * from finish();
rollback;
