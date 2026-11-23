begin;

select plan(27);

-- Transaction-local fixtures: the test leaves no user, workspace or integration behind.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'rexnora-connection-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'rexnora-connection-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'rexnora-connection-outsider@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.workspaces (id, name, owner_id)
values (
  '00000000-0000-0000-0000-000000000010',
  'Rexnora integration connection test',
  '00000000-0000-0000-0000-000000000001'
);

insert into public.workspace_members (workspace_id, user_id, role)
values (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000002',
  'admin'
)
on conflict (workspace_id, user_id) do update set role = excluded.role;

create temporary table _rexnora_integration_test_state (
  name text primary key,
  payload jsonb not null
);

select ok(
  has_function_privilege(
    'service_role',
    'public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'server service role can execute the connection RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated browser role cannot execute the connection RPC'
);

select ok(
  not has_table_privilege('authenticated', 'public.workspace_integration_secrets', 'SELECT'),
  'authenticated browser role cannot read encrypted integration secrets'
);

select ok(
  not has_table_privilege('anon', 'public.workspace_integration_secrets', 'SELECT'),
  'anonymous browser role cannot read encrypted integration secrets'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.save_workspace_database_credentials(uuid,text,text,text,uuid)',
    'EXECUTE'
  ),
  'server role retains the database-credentials compatibility RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.save_workspace_database_credentials(uuid,text,text,text,uuid)',
    'EXECUTE'
  ),
  'browser role cannot execute the database-credentials compatibility RPC'
);

-- The strings below are opaque v1 AES-GCM envelopes. These tests exercise storage
-- and lifecycle behavior; AES-256-GCM round-trip/tamper tests live in the Node suite.
insert into _rexnora_integration_test_state (name, payload)
values (
  'first',
  public.save_workspace_integration_connection(
    '00000000-0000-0000-0000-000000000010',
    'gemini',
    'Gemini agency account A',
    'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.Q2lwaGVydGV4dEE',
    '00000000-0000-0000-0000-000000000002',
    null
  )
);

insert into _rexnora_integration_test_state (name, payload)
values (
  'second',
  public.save_workspace_integration_connection(
    '00000000-0000-0000-0000-000000000010',
    'gemini',
    'Gemini agency account B',
    'v1.BBBBBBBBBBBBBBBB.BBBBBBBBBBBBBBBBBBBBBB.U2Vjb25kQ2lwaGVydGV4dA',
    '00000000-0000-0000-0000-000000000002',
    null
  )
);

select is(
  (select count(*)::integer from public.workspace_integrations
   where workspace_id = '00000000-0000-0000-0000-000000000010'
     and provider = 'gemini' and status = 'needs_attention' and last_test_status is null),
  2,
  'new connections remain unverified until provider testing succeeds'
);

insert into _rexnora_integration_test_state (name, payload)
values (
  'owner_saved',
  public.save_workspace_integration_connection(
    '00000000-0000-0000-0000-000000000010',
    'resend',
    'Agency Resend owner account',
    'v1.FFFFFFFFFFFFFFFF.FFFFFFFFFFFFFFFFFFFFFF.T3duZXJDcmVkZW50aWFs',
    '00000000-0000-0000-0000-000000000001',
    null
  )
);

select is(
  (select payload->>'provider' from _rexnora_integration_test_state where name = 'owner_saved'),
  'resend',
  'workspace owner can save an integration'
);

insert into _rexnora_integration_test_state (name, payload)
values (
  'database_credential',
  jsonb_build_object(
    'id',
    public.save_workspace_database_credentials(
      '00000000-0000-0000-0000-000000000010',
      'mysql',
      'Agency MySQL database',
      'v1.EEEEEEEEEEEEEEEE.EEEEEEEEEEEEEEEEEEEEEE.TXlTUUxDcmVkZW50aWFs',
      '00000000-0000-0000-0000-000000000002'
    )::text
  )
);

select is(
  (select status from public.workspace_integrations
   where id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'database_credential')),
  'needs_attention',
  'legacy database credential RPC keeps its pending-verification status'
);

select is(
  (select encrypted_credentials from public.workspace_integration_secrets
   where integration_id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'database_credential')),
  'v1.EEEEEEEEEEEEEEEE.EEEEEEEEEEEEEEEEEEEEEE.TXlTUUxDcmVkZW50aWFs',
  'legacy database credential RPC stores its encrypted payload through the shared vault'
);

select is(
  (select payload->>'display_name' from _rexnora_integration_test_state where name = 'first'),
  'Gemini agency account A',
  'saving returns safe connection metadata'
);

select ok(
  not ((select payload from _rexnora_integration_test_state where name = 'first') ? 'encrypted_credentials'),
  'save response never includes encrypted credential material'
);

select isnt(
  (select payload->>'id' from _rexnora_integration_test_state where name = 'first'),
  (select payload->>'id' from _rexnora_integration_test_state where name = 'second'),
  'saving a second account creates a distinct connection ID'
);

select is(
  (select count(*)::integer from public.workspace_integrations
   where workspace_id = '00000000-0000-0000-0000-000000000010' and provider = 'gemini'),
  2,
  'multiple accounts for the same provider are stored independently'
);

select is(
  (select count(*)::integer from public.workspace_integration_secrets s
   join public.workspace_integrations i on i.id = s.integration_id
   where i.workspace_id = '00000000-0000-0000-0000-000000000010' and i.provider = 'gemini'),
  2,
  'each saved connection receives its own encrypted secret row'
);

-- Exercise the authenticated read policy on connection metadata. No secret-table
-- privilege is granted to this role.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::integer from public.workspace_integrations
   where workspace_id = '00000000-0000-0000-0000-000000000010' and provider = 'gemini'),
  2,
  'workspace admin can read connection metadata through the authenticated role'
);
reset role;

-- A successful test timestamp must be invalidated when credentials are changed.
update public.workspace_integrations
   set last_tested_at = now(), last_test_status = 'passed'
 where id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'first');

insert into _rexnora_integration_test_state (name, payload)
values (
  'updated_first',
  public.save_workspace_integration_connection(
    '00000000-0000-0000-0000-000000000010',
    'gemini',
    'Gemini agency account A revised',
    'v1.CCCCCCCCCCCCCCCC.CCCCCCCCCCCCCCCCCCCCCC.VXBkYXRlZENpcGhlcnRleHQ',
    '00000000-0000-0000-0000-000000000002',
    (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'first')
  )
);

select is(
  (select display_name from public.workspace_integrations
   where id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'first')),
  'Gemini agency account A revised',
  'updating changes only the selected connection metadata'
);

select ok(
  not ((select payload from _rexnora_integration_test_state where name = 'updated_first') ? 'encrypted_credentials'),
  'update response never includes encrypted credential material'
);

select is(
  (select last_tested_at from public.workspace_integrations
   where id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'first')),
  null::timestamptz,
  'updating credentials clears the previous test timestamp'
);
select is(
  (select status from public.workspace_integrations
   where id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'first')),
  'needs_attention',
  'updating credentials returns the connection to pending verification'
);
select is(
  (select last_test_status from public.workspace_integrations
   where id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'first')),
  null::text,
  'updating credentials clears the previous test result'
);

select is(
  (select encrypted_credentials from public.workspace_integration_secrets
   where integration_id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'first')),
  'v1.CCCCCCCCCCCCCCCC.CCCCCCCCCCCCCCCCCCCCCC.VXBkYXRlZENpcGhlcnRleHQ',
  'updating rotates the selected connection secret'
);

select is(
  (select encrypted_credentials from public.workspace_integration_secrets
   where integration_id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'second')),
  'v1.BBBBBBBBBBBBBBBB.BBBBBBBBBBBBBBBBBBBBBB.U2Vjb25kQ2lwaGVydGV4dA',
  'updating one connection leaves the other account secret unchanged'
);

select throws_ok(
  $$select public.save_workspace_integration_connection(
      '00000000-0000-0000-0000-000000000010',
      'gemini',
      'Unauthorized account',
      'v1.DDDDDDDDDDDDDDDD.DDDDDDDDDDDDDDDDDDDDDD.VW5hdXRob3JpemVk',
      '00000000-0000-0000-0000-000000000003',
      null
    )$$,
  'P0001',
  'INTEGRATION_PERMISSION_DENIED',
  'a non-member cannot save an integration'
);

delete from public.workspace_integrations
 where id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'first')
   and workspace_id = '00000000-0000-0000-0000-000000000010';

select is(
  (select count(*)::integer from public.workspace_integrations
   where id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'first')),
  0,
  'deleting removes the selected integration metadata'
);

select is(
  (select count(*)::integer from public.workspace_integration_secrets
   where integration_id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'first')),
  0,
  'deleting an integration cascades to its encrypted secret'
);

select is(
  (select count(*)::integer from public.workspace_integrations
   where id = (select (payload->>'id')::uuid from _rexnora_integration_test_state where name = 'second')),
  1,
  'deleting one account does not remove the other account'
);

select * from finish();
rollback;
