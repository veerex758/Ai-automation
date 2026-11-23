-- Pin auth helper evaluation to statement scope for all marketplace RLS policies.
drop policy if exists "agent_activity_workspace_insert" on public."agent_activity";
create policy "agent_activity_workspace_insert" on public."agent_activity" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (actor_user_id = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "agent_runs_workspace_insert" on public."agent_runs";
create policy "agent_runs_workspace_insert" on public."agent_runs" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (actor_user_id = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "agent_runs_workspace_update" on public."agent_runs";
create policy "agent_runs_workspace_update" on public."agent_runs" as permissive for UPDATE to authenticated using ((private.is_workspace_member(workspace_id) AND (actor_user_id = ( SELECT (select auth.uid()) AS uid)))) with check ((private.is_workspace_member(workspace_id) AND (actor_user_id = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "agents_workspace_member_insert" on public."agents";
create policy "agents_workspace_member_insert" on public."agents" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "audit_events_insert_member" on public."audit_events";
create policy "audit_events_insert_member" on public."audit_events" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (actor_user_id = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "workspace members read billing payments" on public."billing_payments";
create policy "workspace members read billing payments" on public."billing_payments" as permissive for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = billing_payments.workspace_id) AND (wm.user_id = ( SELECT (select auth.uid()) AS uid))))));
drop policy if exists "marketplace_bundle_refund_buyer_create" on public."marketplace_bundle_refund_requests";
create policy "marketplace_bundle_refund_buyer_create" on public."marketplace_bundle_refund_requests" as permissive for INSERT to authenticated with check (((buyer_user_id = (select auth.uid())) AND (status = 'requested'::text) AND (reviewer_user_id IS NULL) AND (reviewed_at IS NULL) AND (completed_at IS NULL)));
drop policy if exists "marketplace_bundle_refund_buyer_read" on public."marketplace_bundle_refund_requests";
create policy "marketplace_bundle_refund_buyer_read" on public."marketplace_bundle_refund_requests" as permissive for SELECT to authenticated using ((buyer_user_id = (select auth.uid())));
drop policy if exists "marketplace_creator_team_self_membership_read" on public."marketplace_creator_team_members";
create policy "marketplace_creator_team_self_membership_read" on public."marketplace_creator_team_members" as permissive for SELECT to authenticated using ((user_id = (select auth.uid())));
drop policy if exists "marketplace_creator_team_owner_read" on public."marketplace_creator_teams";
create policy "marketplace_creator_team_owner_read" on public."marketplace_creator_teams" as permissive for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM marketplace_creators c
  WHERE ((c.id = marketplace_creator_teams.owner_creator_id) AND (c.user_id = (select auth.uid()))))));
drop policy if exists "marketplace_creators_owner_insert" on public."marketplace_creators";
create policy "marketplace_creators_owner_insert" on public."marketplace_creators" as permissive for INSERT to authenticated with check (((user_id = (select auth.uid())) AND (status = 'pending'::text)));
drop policy if exists "marketplace_creators_owner_update" on public."marketplace_creators";
create policy "marketplace_creators_owner_update" on public."marketplace_creators" as permissive for UPDATE to authenticated using (((user_id = (select auth.uid())) AND (status = 'pending'::text))) with check (((user_id = (select auth.uid())) AND (status = 'pending'::text)));
drop policy if exists "marketplace_creators_read" on public."marketplace_creators";
create policy "marketplace_creators_read" on public."marketplace_creators" as permissive for SELECT to authenticated using (((user_id = ( SELECT (select auth.uid()) AS uid)) OR (status = 'verified'::text)));
drop policy if exists "marketplace_notices_own_read" on public."marketplace_customer_notices";
create policy "marketplace_notices_own_read" on public."marketplace_customer_notices" as permissive for SELECT to authenticated using ((user_id = (select auth.uid())));
drop policy if exists "marketplace_notices_own_update" on public."marketplace_customer_notices";
create policy "marketplace_notices_own_update" on public."marketplace_customer_notices" as permissive for UPDATE to authenticated using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
drop policy if exists "marketplace_entitlements_owner_read" on public."marketplace_entitlements";
create policy "marketplace_entitlements_owner_read" on public."marketplace_entitlements" as permissive for SELECT to authenticated using ((user_id = (select auth.uid())));
drop policy if exists "marketplace_product_collaborators_read" on public."marketplace_product_collaborators";
create policy "marketplace_product_collaborators_read" on public."marketplace_product_collaborators" as permissive for SELECT to authenticated using (((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM (marketplace_products p
     JOIN marketplace_creators c ON ((c.id = p.creator_id)))
  WHERE ((p.id = marketplace_product_collaborators.product_id) AND (c.user_id = (select auth.uid())))))));
drop policy if exists "marketplace_reports_own_insert" on public."marketplace_product_reports";
create policy "marketplace_reports_own_insert" on public."marketplace_product_reports" as permissive for INSERT to authenticated with check (((reporter_id = (select auth.uid())) AND (status = 'open'::text) AND (assigned_to IS NULL) AND (resolved_by IS NULL) AND (resolved_at IS NULL) AND (EXISTS ( SELECT 1
   FROM marketplace_products p
  WHERE ((p.id = marketplace_product_reports.product_id) AND (p.status = ANY (ARRAY['published'::text, 'suspended'::text])))))));
drop policy if exists "marketplace_reports_own_read" on public."marketplace_product_reports";
create policy "marketplace_reports_own_read" on public."marketplace_product_reports" as permissive for SELECT to authenticated using ((reporter_id = (select auth.uid())));
drop policy if exists "marketplace_reviews_own_insert" on public."marketplace_product_reviews";
create policy "marketplace_reviews_own_insert" on public."marketplace_product_reviews" as permissive for INSERT to authenticated with check (((reviewer_id = (select auth.uid())) AND (status = 'published'::text) AND (moderated_by IS NULL) AND (moderated_at IS NULL) AND ((EXISTS ( SELECT 1
   FROM marketplace_purchases p
  WHERE ((p.product_id = marketplace_product_reviews.product_id) AND (p.buyer_user_id = (select auth.uid())) AND (p.status = ANY (ARRAY['paid'::text, 'refunded'::text]))))) OR (EXISTS ( SELECT 1
   FROM marketplace_installations i
  WHERE ((i.product_id = marketplace_product_reviews.product_id) AND (i.installed_by = (select auth.uid())) AND (i.status = ANY (ARRAY['configuring'::text, 'ready'::text, 'active'::text, 'paused'::text, 'removed'::text]))))))));
drop policy if exists "marketplace_reviews_own_update" on public."marketplace_product_reviews";
create policy "marketplace_reviews_own_update" on public."marketplace_product_reviews" as permissive for UPDATE to authenticated using (((reviewer_id = (select auth.uid())) AND (status = 'published'::text) AND (moderated_at IS NULL))) with check (((reviewer_id = (select auth.uid())) AND (moderated_by IS NULL) AND (moderated_at IS NULL)));
drop policy if exists "marketplace_versions_creator_insert" on public."marketplace_product_versions";
create policy "marketplace_versions_creator_insert" on public."marketplace_product_versions" as permissive for INSERT to authenticated with check (((created_by = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM marketplace_products p
  WHERE ((p.id = marketplace_product_versions.product_id) AND (p.created_by = (select auth.uid())) AND (p.status = ANY (ARRAY['draft'::text, 'changes_requested'::text])))))));
drop policy if exists "marketplace_versions_read" on public."marketplace_product_versions";
create policy "marketplace_versions_read" on public."marketplace_product_versions" as permissive for SELECT to authenticated using (((created_by = ( SELECT (select auth.uid()) AS uid)) OR private.marketplace_product_is_public(product_id, id)));
drop policy if exists "marketplace_products_creator_insert" on public."marketplace_products";
create policy "marketplace_products_creator_insert" on public."marketplace_products" as permissive for INSERT to authenticated with check (((created_by = (select auth.uid())) AND (status = 'draft'::text)));
drop policy if exists "marketplace_products_creator_update" on public."marketplace_products";
create policy "marketplace_products_creator_update" on public."marketplace_products" as permissive for UPDATE to authenticated using (((created_by = (select auth.uid())) AND (status = ANY (ARRAY['draft'::text, 'changes_requested'::text])))) with check (((created_by = (select auth.uid())) AND (status = ANY (ARRAY['draft'::text, 'changes_requested'::text]))));
drop policy if exists "marketplace_products_read" on public."marketplace_products";
create policy "marketplace_products_read" on public."marketplace_products" as permissive for SELECT to authenticated using (((created_by = ( SELECT (select auth.uid()) AS uid)) OR private.marketplace_product_is_public(id, current_version_id)));
drop policy if exists "marketplace_purchases_buyer_read" on public."marketplace_purchases";
create policy "marketplace_purchases_buyer_read" on public."marketplace_purchases" as permissive for SELECT to authenticated using ((buyer_user_id = (select auth.uid())));
drop policy if exists "marketplace_reviews_creator_read" on public."marketplace_verification_reviews";
create policy "marketplace_reviews_creator_read" on public."marketplace_verification_reviews" as permissive for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM marketplace_products p
  WHERE ((p.id = marketplace_verification_reviews.product_id) AND (p.created_by = (select auth.uid()))))));
drop policy if exists "real_estate_forms_insert" on public."real_estate_intake_forms";
create policy "real_estate_forms_insert" on public."real_estate_intake_forms" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "real_estate_activities_insert" on public."real_estate_lead_activities";
create policy "real_estate_activities_insert" on public."real_estate_lead_activities" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (actor_user_id = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "real_estate_leads_insert" on public."real_estate_leads";
create policy "real_estate_leads_insert" on public."real_estate_leads" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND ((created_by IS NULL) OR (created_by = ( SELECT (select auth.uid()) AS uid)))));
drop policy if exists "real_estate_notification_recipients_insert" on public."real_estate_notification_recipients";
create policy "real_estate_notification_recipients_insert" on public."real_estate_notification_recipients" as permissive for INSERT to authenticated with check ((private.is_workspace_admin(workspace_id) AND (approved_by = ( SELECT (select auth.uid()) AS uid)) AND (active = true) AND (revoked_by IS NULL) AND (revoked_at IS NULL)));
drop policy if exists "real_estate_properties_insert" on public."real_estate_properties";
create policy "real_estate_properties_insert" on public."real_estate_properties" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND ((created_by IS NULL) OR (created_by = ( SELECT (select auth.uid()) AS uid)))));
drop policy if exists "members can create their own workflow run steps" on public."workflow_run_steps";
create policy "members can create their own workflow run steps" on public."workflow_run_steps" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM workflow_runs r
  WHERE ((r.id = workflow_run_steps.run_id) AND (r.workspace_id = workflow_run_steps.workspace_id) AND (r.workflow_id IS NOT NULL) AND (r.created_by = ( SELECT (select auth.uid()) AS uid)) AND (((r.mode = 'dry_run'::text) AND (r.status = ANY (ARRAY['succeeded'::text, 'failed'::text])) AND (workflow_run_steps.status = ANY (ARRAY['simulated'::text, 'skipped'::text, 'failed'::text]))) OR ((r.mode = 'live'::text) AND (r.status = 'running'::text) AND (workflow_run_steps.status = ANY (ARRAY['simulated'::text, 'skipped'::text, 'executed'::text, 'failed'::text])))))))));
drop policy if exists "members can create workflow run records" on public."workflow_runs";
create policy "members can create workflow run records" on public."workflow_runs" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid)) AND (((mode = 'dry_run'::text) AND (status = ANY (ARRAY['succeeded'::text, 'failed'::text]))) OR ((mode = 'live'::text) AND (status = 'running'::text) AND (idempotency_key IS NOT NULL))) AND (EXISTS ( SELECT 1
   FROM workflows w
  WHERE ((w.id = workflow_runs.workflow_id) AND (w.workspace_id = workflow_runs.workspace_id))))));
drop policy if exists "members can finalize their live workflow runs" on public."workflow_runs";
create policy "members can finalize their live workflow runs" on public."workflow_runs" as permissive for UPDATE to authenticated using ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid)) AND (mode = 'live'::text) AND (status = 'running'::text))) with check ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid)) AND (mode = 'live'::text) AND (status = ANY (ARRAY['succeeded'::text, 'failed'::text]))));
drop policy if exists "workspace members can create workflow schedules" on public."workflow_schedules";
create policy "workspace members can create workflow schedules" on public."workflow_schedules" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid)) AND (EXISTS ( SELECT 1
   FROM workflows w
  WHERE ((w.id = workflow_schedules.workflow_id) AND (w.workspace_id = workflow_schedules.workspace_id))))));
drop policy if exists "workflow_versions_insert_member" on public."workflow_versions";
create policy "workflow_versions_insert_member" on public."workflow_versions" as permissive for INSERT to authenticated with check (((created_by = ( SELECT (select auth.uid()) AS uid)) AND (EXISTS ( SELECT 1
   FROM workflows wf
  WHERE ((wf.id = workflow_versions.workflow_id) AND private.is_workspace_member(wf.workspace_id))))));
drop policy if exists "workflows_insert_member" on public."workflows";
create policy "workflows_insert_member" on public."workflows" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "workspace_dashboards_creator_delete" on public."workspace_dashboards";
create policy "workspace_dashboards_creator_delete" on public."workspace_dashboards" as permissive for DELETE to authenticated using ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "workspace_dashboards_creator_update" on public."workspace_dashboards";
create policy "workspace_dashboards_creator_update" on public."workspace_dashboards" as permissive for UPDATE to authenticated using ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid)))) with check ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "workspace_dashboards_member_insert" on public."workspace_dashboards";
create policy "workspace_dashboards_member_insert" on public."workspace_dashboards" as permissive for INSERT to authenticated with check ((private.is_workspace_member(workspace_id) AND (created_by = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "workspace owners and admins can add integration metadata" on public."workspace_integrations";
create policy "workspace owners and admins can add integration metadata" on public."workspace_integrations" as permissive for INSERT to authenticated with check (((private.is_workspace_owner(workspace_id) OR (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspace_integrations.workspace_id) AND (wm.user_id = ( SELECT (select auth.uid()) AS uid)) AND (wm.role = 'admin'::text))))) AND (created_by = ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "workspace owners and admins can delete integration metadata" on public."workspace_integrations";
create policy "workspace owners and admins can delete integration metadata" on public."workspace_integrations" as permissive for DELETE to authenticated using ((private.is_workspace_owner(workspace_id) OR (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspace_integrations.workspace_id) AND (wm.user_id = ( SELECT (select auth.uid()) AS uid)) AND (wm.role = 'admin'::text))))));
drop policy if exists "workspace owners and admins can update integration metadata" on public."workspace_integrations";
create policy "workspace owners and admins can update integration metadata" on public."workspace_integrations" as permissive for UPDATE to authenticated using ((private.is_workspace_owner(workspace_id) OR (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspace_integrations.workspace_id) AND (wm.user_id = ( SELECT (select auth.uid()) AS uid)) AND (wm.role = 'admin'::text)))))) with check ((private.is_workspace_owner(workspace_id) OR (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = workspace_integrations.workspace_id) AND (wm.user_id = ( SELECT (select auth.uid()) AS uid)) AND (wm.role = 'admin'::text))))));
drop policy if exists "workspace_members_delete_admin" on public."workspace_members";
create policy "workspace_members_delete_admin" on public."workspace_members" as permissive for DELETE to authenticated using ((private.is_workspace_admin(workspace_id) AND (user_id <> ( SELECT (select auth.uid()) AS uid))));
drop policy if exists "workspace_members_insert_admin_or_owner_setup" on public."workspace_members";
create policy "workspace_members_insert_admin_or_owner_setup" on public."workspace_members" as permissive for INSERT to authenticated with check ((private.is_workspace_admin(workspace_id) OR ((user_id = ( SELECT (select auth.uid()) AS uid)) AND (role = 'owner'::text) AND (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_id = ( SELECT (select auth.uid()) AS uid))))))));
drop policy if exists "workspace_members_select_self_or_admin" on public."workspace_members";
create policy "workspace_members_select_self_or_admin" on public."workspace_members" as permissive for SELECT to authenticated using (((user_id = ( SELECT (select auth.uid()) AS uid)) OR private.is_workspace_admin(workspace_id)));
drop policy if exists "workspace_node_installations_admin_insert" on public."workspace_node_installations";
create policy "workspace_node_installations_admin_insert" on public."workspace_node_installations" as permissive for INSERT to authenticated with check ((private.is_workspace_admin(workspace_id) AND (installed_by = ( SELECT (select auth.uid()) AS uid)) AND (status = 'disabled'::text) AND (disabled_at IS NOT NULL) AND (uninstalled_at IS NULL) AND (EXISTS ( SELECT 1
   FROM ((node_package_versions v
     JOIN node_packages p ON ((p.id = v.package_id)))
     JOIN node_publishers pub ON ((pub.id = p.publisher_id)))
  WHERE ((v.id = workspace_node_installations.package_version_id) AND (v.review_status = 'approved'::text) AND (p.status = 'active'::text) AND (pub.verification_status = 'verified'::text))))));
drop policy if exists "workspace_node_permission_grants_admin_insert" on public."workspace_node_permission_grants";
create policy "workspace_node_permission_grants_admin_insert" on public."workspace_node_permission_grants" as permissive for INSERT to authenticated with check ((private.is_workspace_admin(workspace_id) AND (granted_by = ( SELECT (select auth.uid()) AS uid)) AND (EXISTS ( SELECT 1
   FROM (workspace_node_installations i
     JOIN node_package_versions v ON ((v.id = i.package_version_id)))
  WHERE ((i.id = workspace_node_permission_grants.installation_id) AND (i.workspace_id = workspace_node_permission_grants.workspace_id) AND (i.status = ANY (ARRAY['active'::text, 'disabled'::text])) AND ((v.manifest -> 'permissions'::text) ? workspace_node_permission_grants.permission))))));
drop policy if exists "workspace_node_permission_grants_admin_update" on public."workspace_node_permission_grants";
create policy "workspace_node_permission_grants_admin_update" on public."workspace_node_permission_grants" as permissive for UPDATE to authenticated using ((private.is_workspace_admin(workspace_id) AND (status = 'active'::text))) with check ((private.is_workspace_admin(workspace_id) AND (status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (revoked_by = ( SELECT (select auth.uid()) AS uid)) AND (EXISTS ( SELECT 1
   FROM workspace_node_installations i
  WHERE ((i.id = workspace_node_permission_grants.installation_id) AND (i.workspace_id = workspace_node_permission_grants.workspace_id))))));
drop policy if exists "workspaces_insert_owner" on public."workspaces";
create policy "workspaces_insert_owner" on public."workspaces" as permissive for INSERT to authenticated with check ((owner_id = ( SELECT (select auth.uid()) AS uid)));
drop policy if exists "workspaces_select_member" on public."workspaces";
create policy "workspaces_select_member" on public."workspaces" as permissive for SELECT to authenticated using ((private.is_workspace_member(id) OR (owner_id = ( SELECT (select auth.uid()) AS uid))));
