begin;
select plan(13);

select has_table('public','real_estate_notification_recipients','explicit agency alert recipient allowlist exists');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid='public.real_estate_notification_recipients'::regclass),
  'agency recipient allowlist has row level security enabled'
);
select ok(not has_table_privilege('anon','public.real_estate_notification_recipients','SELECT'),'anonymous users cannot read agency recipient emails');
select ok(not has_table_privilege('anon','public.real_estate_notification_recipients','INSERT'),'anonymous users cannot approve agency recipients');
select ok(has_table_privilege('authenticated','public.real_estate_notification_recipients','SELECT'),'authenticated workspace users can list recipients subject to RLS');
select ok(has_column_privilege('authenticated','public.real_estate_notification_recipients','workspace_id','INSERT'),'recipient inserts are scoped to an explicit workspace');
select ok(has_column_privilege('authenticated','public.real_estate_notification_recipients','email','INSERT'),'workspace admins can add an email address');
select ok(has_column_privilege('authenticated','public.real_estate_notification_recipients','active','INSERT'),'workspace admins can activate a recipient');
select ok(not has_column_privilege('authenticated','public.real_estate_notification_recipients','approved_by','INSERT'),'clients cannot choose the approval actor');
select ok(not has_column_privilege('authenticated','public.real_estate_notification_recipients','approved_at','UPDATE'),'clients cannot rewrite the approval timestamp');
select ok(has_column_privilege('authenticated','public.real_estate_notification_recipients','active','UPDATE'),'workspace admins can revoke or reapprove a recipient subject to RLS');
select ok(not has_table_privilege('authenticated','public.real_estate_notification_recipients','DELETE'),'clients cannot delete recipient audit history');
select ok(
  exists(select 1 from pg_trigger where tgrelid='public.real_estate_notification_recipients'::regclass
    and tgname='real_estate_notification_recipients_enforce_audit' and not tgisinternal),
  'database trigger owns approval and revocation audit fields'
);

select * from finish();
rollback;
