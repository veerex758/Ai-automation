begin;
select plan(20);

-- The new save RPC is deliberately unavailable to browser roles.
select ok(
  not has_function_privilege('anon','public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid)','EXECUTE'),
  'anonymous clients cannot save workspace connections'
);
select ok(
  not has_function_privilege('authenticated','public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid)','EXECUTE'),
  'authenticated browser clients cannot call the secret-writing RPC'
);
select ok(
  has_function_privilege('service_role','public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid)','EXECUTE'),
  'only server service role can call the connection save RPC'
);
select ok(
  not has_table_privilege('authenticated','public.workspace_integration_secrets','SELECT'),
  'workspace members cannot read encrypted provider secrets directly'
);

-- Two workspaces, a workspace admin and a non-admin member.
insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('a1111111-1111-4111-8111-111111111111','authenticated','authenticated','conn-owner-a@example.invalid','',now(),now()),
  ('a2222222-2222-4222-8222-222222222222','authenticated','authenticated','conn-owner-b@example.invalid','',now(),now()),
  ('a3333333-3333-4333-8333-333333333333','authenticated','authenticated','conn-member@example.invalid','',now(),now())
on conflict(id) do nothing;

insert into public.workspaces(id,name,owner_id) values
  ('b1111111-1111-4111-8111-111111111111','Connection Workspace A','a1111111-1111-4111-8111-111111111111'),
  ('b2222222-2222-4222-8222-222222222222','Connection Workspace B','a2222222-2222-4222-8222-222222222222')
on conflict(id) do nothing;

insert into public.workspace_members(workspace_id,user_id,role) values
  ('b1111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222','admin'),
  ('b1111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333333','member')
on conflict(workspace_id,user_id) do update set role=excluded.role;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

-- The same workspace can store two independent accounts for one provider.
select lives_ok(
 $$select public.save_workspace_integration_connection(
   'b1111111-1111-4111-8111-111111111111','gemini','Gemini account A','v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.Q2lwaGVydGV4dEE',
   'a2222222-2222-4222-8222-222222222222',null
 )$$,
 'workspace admin can create the first Gemini account'
);
select lives_ok(
 $$select public.save_workspace_integration_connection(
   'b1111111-1111-4111-8111-111111111111','gemini','Gemini account B','v1.BBBBBBBBBBBBBBBB.BBBBBBBBBBBBBBBBBBBBBB.U2Vjb25kQ2lwaGVydGV4dA',
   'a2222222-2222-4222-8222-222222222222',null
 )$$,
 'workspace admin can create a second Gemini account'
);
select is(
 (select count(*)::integer from public.workspace_integrations
  where workspace_id='b1111111-1111-4111-8111-111111111111' and provider='gemini'),
 2,
 'multiple accounts for one provider coexist in a workspace'
);
select is(
 (select count(*)::integer from public.workspace_integrations
  where workspace_id='b1111111-1111-4111-8111-111111111111' and provider='gemini'
    and status='needs_attention' and last_test_status is null),
 2,
 'new connections remain unverified until a provider test passes'
);

-- Mark both verified, then rotate only account A.
update public.workspace_integrations
set status='connected',last_tested_at=now(),last_test_status='passed'
where workspace_id='b1111111-1111-4111-8111-111111111111' and provider='gemini';
select is(
 (select count(*)::integer from public.workspace_integrations
  where workspace_id='b1111111-1111-4111-8111-111111111111' and provider='gemini'
    and status='connected' and last_test_status='passed'),
 2,
 'both separate accounts can be marked verified'
);

create temporary table connection_fixture as
select id,display_name from public.workspace_integrations
where workspace_id='b1111111-1111-4111-8111-111111111111' and provider='gemini'
order by display_name;
select is((select count(*)::integer from connection_fixture),2,'fixture captures both account IDs');

select lives_ok(
 $$select public.save_workspace_integration_connection(
   'b1111111-1111-4111-8111-111111111111','gemini','Gemini account A rotated','v1.CCCCCCCCCCCCCCCC.CCCCCCCCCCCCCCCCCCCCCC.VXBkYXRlZENpcGhlcnRleHQ',
   'a2222222-2222-4222-8222-222222222222',
   (select id from connection_fixture where display_name='Gemini account A')
 )$$,
 'rotating one connection updates only the selected account'
);
select is(
 (select count(*)::integer from public.workspace_integrations
  where workspace_id='b1111111-1111-4111-8111-111111111111' and provider='gemini'),
 2,
 'rotation does not create or remove another account'
);
select is(
 (select last_test_status from public.workspace_integrations
  where id=(select id from connection_fixture where display_name='Gemini account A')),
 null::text,
 'rotated account loses its previous verification'
);
select is(
 (select status from public.workspace_integrations
  where id=(select id from connection_fixture where display_name='Gemini account A')),
 'needs_attention',
 'rotated account returns to pending verification'
);
select is(
 (select last_test_status from public.workspace_integrations
  where id=(select id from connection_fixture where display_name='Gemini account B')),
 'passed',
 'other saved account keeps its successful verification'
);
select is(
 (select count(*)::integer from public.workspace_integration_secrets s
  join public.workspace_integrations i on i.id=s.integration_id
  where i.workspace_id='b1111111-1111-4111-8111-111111111111' and i.provider='gemini'),
 2,
 'each account has its own encrypted secret record'
);

-- Create an account in workspace B and attempt to use its ID while saving in A.
select lives_ok(
 $$select public.save_workspace_integration_connection(
   'b2222222-2222-4222-8222-222222222222','gemini','Workspace B Gemini','v1.DDDDDDDDDDDDDDDD.DDDDDDDDDDDDDDDDDDDDDD.V29ya3NwYWNlQkNyZWQ',
   'a2222222-2222-4222-8222-222222222222',null
 )$$,
 'workspace B owner can create an account in workspace B'
);

select lives_ok(
 $$do $body$
 declare v_rejected boolean := false;
 begin
   begin
     perform public.save_workspace_integration_connection(
       'b1111111-1111-4111-8111-111111111111','gemini','Cross-workspace overwrite','v1.EEEEEEEEEEEEEEEE.EEEEEEEEEEEEEEEEEEEEEE.Q3Jvc3NXb3Jrc3BhY2U',
       'a2222222-2222-4222-8222-222222222222',
       (select id from public.workspace_integrations
        where workspace_id='b2222222-2222-4222-8222-222222222222' and provider='gemini')
     );
   exception when sqlstate 'P0001' then
     if sqlerrm <> 'INTEGRATION_CONNECTION_NOT_FOUND' then raise; end if;
     v_rejected := true;
   end;
   if not v_rejected then raise exception 'cross-workspace connection ID was accepted'; end if;
 end
 $body$;$$,
 'workspace A rejects a connection ID owned by workspace B'
);
select is(
 (select count(*)::integer from public.workspace_integrations
  where workspace_id='b1111111-1111-4111-8111-111111111111' and provider='gemini'),
 2,
 'cross-workspace attempt leaves workspace A accounts unchanged'
);

select lives_ok(
 $$do $body$
 declare v_rejected boolean := false;
 begin
   begin
     perform public.save_workspace_integration_connection(
       'b1111111-1111-4111-8111-111111111111','gemini','Member must not write','v1.FFFFFFFFFFFFFFFF.FFFFFFFFFFFFFFFFFFFFFF.TWVtYmVyQ3JlZGVudGlhbA',
       'a3333333-3333-4333-8333-333333333333',null
     );
   exception when sqlstate 'P0001' then
     if sqlerrm <> 'INTEGRATION_PERMISSION_DENIED' then raise; end if;
     v_rejected := true;
   end;
   if not v_rejected then raise exception 'non-admin member was accepted'; end if;
 end
 $body$;$$,
 'non-admin workspace member cannot create provider connections'
);

select * from finish();
rollback;
