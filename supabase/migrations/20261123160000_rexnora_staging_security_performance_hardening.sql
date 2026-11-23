-- Remove duplicate subscription SELECT policy left by the legacy Paystack schema.
drop policy if exists "workspace members read subscription" on public.workspace_subscriptions;

-- Evaluate auth.uid() once per statement rather than once per affected row.
drop policy if exists agent_activity_workspace_insert on public.agent_activity;
create policy agent_activity_workspace_insert on public.agent_activity
 for insert to authenticated
 with check (private.is_workspace_member(workspace_id) and actor_user_id = (select auth.uid()));

drop policy if exists agent_runs_workspace_insert on public.agent_runs;
create policy agent_runs_workspace_insert on public.agent_runs
 for insert to authenticated
 with check (private.is_workspace_member(workspace_id) and actor_user_id = (select auth.uid()));

drop policy if exists agent_runs_workspace_update on public.agent_runs;
create policy agent_runs_workspace_update on public.agent_runs
 for update to authenticated
 using (private.is_workspace_member(workspace_id) and actor_user_id = (select auth.uid()))
 with check (private.is_workspace_member(workspace_id) and actor_user_id = (select auth.uid()));

drop policy if exists agents_workspace_member_insert on public.agents;
create policy agents_workspace_member_insert on public.agents
 for insert to authenticated
 with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()));

drop policy if exists "workspace members read billing payments" on public.billing_payments;
create policy "workspace members read billing payments" on public.billing_payments
 for select to authenticated
 using (exists (
   select 1 from public.workspace_members wm
   where wm.workspace_id = billing_payments.workspace_id
     and wm.user_id = (select auth.uid())
 ));

drop policy if exists real_estate_forms_insert on public.real_estate_intake_forms;
create policy real_estate_forms_insert on public.real_estate_intake_forms
 for insert to authenticated
 with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()));

drop policy if exists real_estate_activities_insert on public.real_estate_lead_activities;
create policy real_estate_activities_insert on public.real_estate_lead_activities
 for insert to authenticated
 with check (private.is_workspace_member(workspace_id) and actor_user_id = (select auth.uid()));

drop policy if exists real_estate_leads_insert on public.real_estate_leads;
create policy real_estate_leads_insert on public.real_estate_leads
 for insert to authenticated
 with check (private.is_workspace_member(workspace_id) and (created_by is null or created_by = (select auth.uid())));

drop policy if exists real_estate_notification_recipients_insert on public.real_estate_notification_recipients;
create policy real_estate_notification_recipients_insert on public.real_estate_notification_recipients
 for insert to authenticated
 with check (private.is_workspace_admin(workspace_id)
   and approved_by = (select auth.uid())
   and active = true and revoked_by is null and revoked_at is null);

drop policy if exists real_estate_properties_insert on public.real_estate_properties;
create policy real_estate_properties_insert on public.real_estate_properties
 for insert to authenticated
 with check (private.is_workspace_member(workspace_id) and (created_by is null or created_by = (select auth.uid())));

drop policy if exists workspace_dashboards_member_insert on public.workspace_dashboards;
create policy workspace_dashboards_member_insert on public.workspace_dashboards
 for insert to authenticated
 with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()));

drop policy if exists workspace_dashboards_creator_update on public.workspace_dashboards;
create policy workspace_dashboards_creator_update on public.workspace_dashboards
 for update to authenticated
 using (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()))
 with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()));

drop policy if exists workspace_dashboards_creator_delete on public.workspace_dashboards;
create policy workspace_dashboards_creator_delete on public.workspace_dashboards
 for delete to authenticated
 using (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()));

-- Cover all currently unindexed foreign keys. Composite FK indexes follow FK column order.
create index if not exists ix_fk_agent_activity_actor on public.agent_activity(actor_user_id);
create index if not exists ix_fk_agent_activity_workspace on public.agent_activity(workspace_id);
create index if not exists ix_fk_agent_runs_actor on public.agent_runs(actor_user_id);
create index if not exists ix_fk_agents_created_by on public.agents(created_by);
create index if not exists ix_fk_billing_payments_user on public.billing_payments(user_id);
create index if not exists ix_fk_execution_dead_letters_run on public.execution_dead_letters(run_id);
create index if not exists ix_fk_execution_dead_letters_workflow on public.execution_dead_letters(workflow_id);
create index if not exists ix_fk_execution_jobs_workflow on public.execution_jobs(workflow_id);
create index if not exists ix_fk_execution_worker_heartbeats_job on public.execution_worker_heartbeats(current_job_id);
create index if not exists ix_fk_real_estate_followups_lead_workspace on public.real_estate_followups(lead_id,workspace_id);
create index if not exists ix_fk_real_estate_followups_workspace on public.real_estate_followups(workspace_id);
create index if not exists ix_fk_real_estate_intake_forms_creator on public.real_estate_intake_forms(created_by);
create index if not exists ix_fk_real_estate_intake_forms_workspace on public.real_estate_intake_forms(workspace_id);
create index if not exists ix_fk_real_estate_lead_activities_lead_workspace on public.real_estate_lead_activities(lead_id,workspace_id);
create index if not exists ix_fk_real_estate_lead_activities_actor on public.real_estate_lead_activities(actor_user_id);
create index if not exists ix_fk_real_estate_lead_activities_workspace on public.real_estate_lead_activities(workspace_id);
create index if not exists ix_fk_real_estate_leads_created_by on public.real_estate_leads(created_by);
create index if not exists ix_fk_real_estate_leads_workflow on public.real_estate_leads(workflow_id);
create index if not exists ix_fk_real_estate_leads_workflow_run on public.real_estate_leads(workflow_run_id);
create index if not exists ix_fk_real_estate_recipients_approved_by on public.real_estate_notification_recipients(approved_by);
create index if not exists ix_fk_real_estate_recipients_revoked_by on public.real_estate_notification_recipients(revoked_by);
create index if not exists ix_fk_real_estate_properties_created_by on public.real_estate_properties(created_by);
create index if not exists ix_fk_workspace_alert_deliveries_destination on public.workspace_alert_deliveries(destination_id);
create index if not exists ix_fk_workspace_alert_destinations_created_by on public.workspace_alert_destinations(created_by);
create index if not exists ix_fk_workspace_alert_preferences_updated_by on public.workspace_alert_preferences(updated_by);
create index if not exists ix_fk_workspace_custom_roles_created_by on public.workspace_custom_roles(created_by);
create index if not exists ix_fk_workspace_dashboards_created_by on public.workspace_dashboards(created_by);
create index if not exists ix_fk_workspace_invitations_invited_by on public.workspace_invitations(invited_by);
create index if not exists ix_fk_provider_approvals_decided_by on public.workspace_provider_operation_approvals(decided_by);
create index if not exists ix_fk_workspace_security_updated_by on public.workspace_security_settings(updated_by);
create index if not exists ix_fk_workspace_subscriptions_payment on public.workspace_subscriptions(last_payment_id);
create index if not exists ix_fk_workspace_usage_actor on public.workspace_usage(actor_user_id);
