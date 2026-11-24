-- Targeted indexes for pilot-table foreign keys identified by Supabase advisors.
-- Each index starts with the referenced child key so deletes/updates on parents
-- and workspace-scoped joins do not require a full scan of these new tables.

create index if not exists real_estate_inspection_bookings_lead_fk_idx
  on public.real_estate_inspection_bookings(lead_id);
create index if not exists real_estate_inspection_bookings_property_fk_idx
  on public.real_estate_inspection_bookings(property_id);
create index if not exists real_estate_inspection_bookings_agent_fk_idx
  on public.real_estate_inspection_bookings(agent_id);
create index if not exists real_estate_inspection_bookings_google_connection_fk_idx
  on public.real_estate_inspection_bookings(google_connection_id);
create index if not exists real_estate_inspection_bookings_requested_by_fk_idx
  on public.real_estate_inspection_bookings(requested_by);
create index if not exists real_estate_inspection_bookings_approved_by_fk_idx
  on public.real_estate_inspection_bookings(approved_by);

create index if not exists real_estate_playbook_decisions_lead_fk_idx
  on public.real_estate_playbook_decisions(lead_id, workspace_id);
create index if not exists real_estate_playbook_decisions_workflow_fk_idx
  on public.real_estate_playbook_decisions(workflow_id, workspace_id);
create index if not exists real_estate_playbook_decisions_version_fk_idx
  on public.real_estate_playbook_decisions(workflow_id, workflow_version);
create index if not exists real_estate_playbook_decisions_decided_by_fk_idx
  on public.real_estate_playbook_decisions(decided_by);

create index if not exists real_estate_tasks_lead_fk_idx
  on public.real_estate_tasks(lead_id);
create index if not exists real_estate_tasks_agent_fk_idx
  on public.real_estate_tasks(assigned_agent_id);
create index if not exists real_estate_tasks_created_by_fk_idx
  on public.real_estate_tasks(created_by);
