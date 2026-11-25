-- Foreign-key access paths for workspace-scoped real-estate operational records.
-- Applied to the linked staging project on 2026-11-24.

create index if not exists real_estate_inspection_bookings_agent_fk_idx
  on public.real_estate_inspection_bookings(agent_id);
create index if not exists real_estate_inspection_bookings_approved_by_fk_idx
  on public.real_estate_inspection_bookings(approved_by);
create index if not exists real_estate_inspection_bookings_google_connection_fk_idx
  on public.real_estate_inspection_bookings(google_connection_id);
create index if not exists real_estate_inspection_bookings_lead_fk_idx
  on public.real_estate_inspection_bookings(lead_id);
create index if not exists real_estate_inspection_bookings_property_fk_idx
  on public.real_estate_inspection_bookings(property_id);
create index if not exists real_estate_inspection_bookings_requested_by_fk_idx
  on public.real_estate_inspection_bookings(requested_by);

create index if not exists real_estate_tasks_agent_fk_idx
  on public.real_estate_tasks(assigned_agent_id);
create index if not exists real_estate_tasks_created_by_fk_idx
  on public.real_estate_tasks(created_by);
create index if not exists real_estate_tasks_lead_fk_idx
  on public.real_estate_tasks(lead_id);
