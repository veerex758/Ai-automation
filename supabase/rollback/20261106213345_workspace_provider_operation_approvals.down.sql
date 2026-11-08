-- Rollback for 20261106213345_workspace_provider_operation_approvals.sql.
-- Export the approval ledger before rollback. This guard prevents accidental
-- loss of approval/revocation history if the table has already been used.
do $$
begin
  if to_regclass('public.workspace_provider_operation_approvals') is not null
     and exists (select 1 from public.workspace_provider_operation_approvals limit 1) then
    raise exception 'Export workspace_provider_operation_approvals before rollback';
  end if;
end
$$;

drop table if exists public.workspace_provider_operation_approvals;
