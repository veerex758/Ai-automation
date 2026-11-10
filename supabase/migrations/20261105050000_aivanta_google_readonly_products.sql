-- Expand the server-only Google OAuth product allowlist for six read-only integrations.
-- The application requests only the individual product's read-only scope.
alter table public.google_connections
  drop constraint if exists google_connections_product_check;

alter table public.google_connections
  add constraint google_connections_product_check
  check (product in ('gmail', 'sheets', 'drive', 'calendar', 'docs', 'forms', 'youtube', 'contacts'));
