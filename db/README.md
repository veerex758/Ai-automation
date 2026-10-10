# Database setup

Aivanta uses PostgreSQL for the planned persistent workflow store. The initial schema is in `migrations/001_initial_schema.sql`.

1. Provision a PostgreSQL database (a managed free tier is suitable for development).
2. Set `DATABASE_URL` in your local environment or deployment secret store. Never commit the value.
3. Set `DATABASE_SSL=true` when the provider requires TLS with certificate verification.
4. Apply `migrations/001_initial_schema.sql` using your PostgreSQL migration workflow.
5. Restart the application and verify connectivity from a server-side environment.

The schema includes workspaces, workflow definitions, immutable version snapshots, and audit events. This is a foundation, not a production-ready multi-tenant API. Authentication and authorization must be implemented before any route reads or writes customer records; do not accept a workspace ID from an unauthenticated client as proof of access. Workflow activation and execution must remain disabled until authorization, validation, audit logging, and execution safeguards are enforced server-side.
