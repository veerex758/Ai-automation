# Supabase setup (Aivanta)

This folder contains version-controlled migrations for Aivanta's dedicated Supabase project. Never run these migrations against another application's project.

- Project ref: `xymbwkegcpjxlgclqiop`
- API URL: `https://xymbwkegcpjxlgclqiop.supabase.co`
- Region: `eu-west-1`

## Migrations
1. `20261010180000_aivanta_workspace_workflow_foundation.sql` — workspaces, memberships, workflows, workflow versions, audit events, triggers, indexes, and RLS.
2. `20261010180100_aivanta_security_performance_hardening.sql` — foreign-key indexes, account deletion compatibility, and restricted trigger-function execute privileges.

These migrations have been applied to the dedicated project and checked afterward. All five public tables have RLS enabled; Supabase's security advisor returned no findings at verification time.

## Security
- Browser clients may use only the publishable key. Never commit database passwords, service-role keys, or secret API keys.
- The `private` schema holds RLS helper functions with a fixed search path; only authenticated users may execute them.
- All public tables deny `anon` access and require authenticated RLS policies.
- Create a workspace with `owner_id = auth.uid()`, then add the creator to `workspace_members` with role `owner`. The workspace owner is also recognized by RLS before membership insertion.
- Workflow execution, OAuth integrations, billing, and authenticated application CRUD are not implemented merely by creating these tables.

Configure the project's URL and publishable key through local/deployment environment variables; keep private credentials in deployment secrets.
