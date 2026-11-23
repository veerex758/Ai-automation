# Rexnora Stage 3 — Staging migration reconciliation

Date: 2026-11-23  
Target: Supabase staging project `ygclofqxtztnynkljipj` (`aivanta-staging`)  
Production project: untouched.

## Result

- Repository migration files inspected across the Stage 3 integration branch and the staging-fix branch: **158**.
- Staging migration ledger entries before reconciliation: **148**.
- Source migration versions reconciled into `supabase_migrations.schema_migrations`: **114**.
- Repository migration versions now recognized as applied: **153 / 158**.
- Deliberately deferred migrations: **5**.
- Existing migration ledger rows were retained. No migration history was deleted and no database reset was performed.

The 114 version entries were added only after verifying that the corresponding schema changes had been applied, or that a newer implementation already superseded the old migration. The statements array for these repair entries is empty, matching the intent of a migration-repair operation rather than replaying SQL.

## Superseded migrations recorded as applied

| Migration | Reconciliation |
|---|---|
| `20261103040000_aivanta_safe_community_node_installations` | Superseded by the existing package-based node installation and marketplace schema. The older `node_id` model is incompatible with the current package/version model. |
| `20261103050000_aivanta_integration_provider_allowlist` | Superseded by the connection-aware integration migration and expanded provider registry. |
| `20261104120000_aivanta_durable_wait_resume` | Covered by the later durable runtime reconciliation migration. |
| `20261105020000` through `20261105090000` provider-specific credential migrations | Superseded by generalized, connection-specific encrypted credential storage and provider validation. |
| `20261106213337_mysql_mongodb_workspace_credentials` | Superseded by the hardened connection-aware database credential RPC. |
| `20261114072345_aivanta_agent_management` and `20261114072349_aivanta_agent_runs` | Duplicate agent schema versions. Existing agent/agent-run tables were already applied and subsequently hardened. |
| `20261109100000_aivanta_paystack_payment_ledger` and `20261109121000_aivanta_paystack_plan_aware_settlement` | Existing billing ledger was verified; plan-aware Paystack settlement is supplied by `20261123200000_rexnora_paystack_plan_aware_settlement`. |

## Applied and verified migration groups

- Durable execution, cancellation, wait/resume, worker runtime reconciliation and recovery.
- Workspace integrations, multi-account connection identity and connection-bound credential encryption.
- Cron schedules and provider operation approvals.
- Agent management, agent runs and usage metering.
- Subscription entitlements, billing lifecycle, security settings, operational alerts and custom roles.
- Real-estate lead pipeline, follow-up controls, recovery and notification recipients.
- AI credit wallet.
- Marketplace foundation, creator verification, artifact privacy, financial ledger, payouts, bundles, provider checkout, API keys, collections, teams, installation lifecycle and customer trust.
- Staging-specific security, RLS, performance and migration compatibility hardening.

## Deliberately deferred

These five migrations remain pending and must not be marked applied until their separate recurring-billing acceptance work is completed:

1. `20261114200000_aivanta_recurring_billing_tax_invoices`
2. `20261114210000_aivanta_recurring_subscription_lifecycle`
3. `20261114220000_aivanta_invoice_customer_snapshot`
4. `20261114230000_aivanta_paystack_recurring_setup`
5. `20261123104500_aivanta_recurring_billing_recovery_and_consent`

## Safety

- Targeted only the staging project.
- No Production Supabase migration, environment-variable change or data modification.
- No NegosMint project changes.
- No blind replay, database reset or destructive migration.
