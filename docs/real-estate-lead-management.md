# Real-estate lead management template

This is the first customer-facing industry template built on Rexnora's workspace-scoped execution foundation.

## Implemented capabilities

- Public enquiry forms use a high-entropy one-time public key. Only its SHA-256 hash is stored.
- Form submissions must come from an explicitly allowed origin, include a unique Idempotency-Key, pass a workspace/IP rate limit and contain a name, contact method and explicit contact-consent choice.
- Lead records are workspace-scoped and retain source, intent, property requirements, budget, timeline, finance readiness, consent, qualification, deterministic score, status and timestamps.
- Lead scoring is calculated in application code from explainable factors. Gemini does not choose the numeric score.
- Agent assignment verifies that the agent is in the same workspace.
- Property matching only returns active listings marked available whose price and location are stored and whose availability was verified within the last seven days.
- Follow-up checkpoints are persisted for immediately, 1 day, 7 days, 30 days and 90 days, only for a consenting customer who selected email and supplied an email address.
- Follow-ups stop when consent is withdrawn, the customer responds, an agent takes over or the lead is won/lost.
- The cron dispatcher uses an atomic database claim/lease and Resend idempotency keys. Each attempt and provider acceptance is persisted.

## Database migration

The existing base and real-estate versions are already represented in the staging migration ledger. Do not replay or repair those rows by hand. The Playbook source migration `20261124125748_rexnora_playbook_policy_inbox.sql` is kept faithful to the three-argument RPC deployed in staging; the correction-capable four-argument RPC is introduced separately by `20261124161000_rexnora_playbook_decision_corrections.sql`. The CRM outcome and bounded WhatsApp retry schema is additive in `20261124170000_rexnora_real_estate_crm_and_whatsapp_retries.sql`. Apply only versions that the target database does not already record, through the reviewed Supabase migration process; record the exact versions returned by Supabase in source control. Never delete, rewrite or mark historical migration rows applied to conceal schema drift. No new migration in this branch has been applied to staging or production yet.

## Configure public intake

1. Sign in and open Dashboard → Real Estate.
2. Create an intake form with one or more exact website origins (for example https://agency.example).
3. Copy the public key immediately. It is shown once; the database stores only its hash.
4. POST JSON to the returned /api/real-estate/intake/{publicKey} endpoint. Include an Idempotency-Key header that is unique per submitted enquiry.
5. Include consentToContact as an explicit boolean. Consent is not assumed by the form.

The public endpoint accepts JSON with fullName, email, phone, transactionType, propertyType, preferredLocation, budgetMin, budgetMax, currency, timeframe, readiness, contactPreference, consentToContact, consentText and optional message.

## Approve agency alert recipients

Workspace owner/admin users must add each approved agency inbox in Dashboard → Real Estate → Website forms → Approved agency alert recipients. Only active addresses in this allowlist receive Gemini qualification summaries. Rexnora does not infer recipients from workspace owner/admin profile email addresses. Revocation blocks future notifications to that address; approval and revocation timestamps and actors are retained for audit.

The pipeline remains blocked until at least one agency recipient is explicitly approved. Re-approving an address records a fresh approval timestamp. Notification delivery uses the registered Email → Send email operation and stable idempotency keys.

## Enable follow-up delivery

The queue and dispatcher are implemented, but sending stays disabled until all checks below pass:

- Configure the server-only Supabase service-role/secret key and credential-encryption key. Never expose either with a `NEXT_PUBLIC_` variable.
- Set `AIVANTA_LIVE_EXECUTION_ENABLED=true`, `REAL_ESTATE_PIPELINE_ENABLED=true` and `REAL_ESTATE_FOLLOWUPS_ENABLED=true` only after provider connections, tests, approvals and the agency recipient allowlist are complete.
- Connect and successfully test Gemini and Resend in the same workspace. The worker decrypts only that workspace's credential envelope.
- Approve the registered `gemini / qualify_real_estate_lead` and `email / send_email` operations for the workspace.
- Add the agency's designated inbox to the explicit recipient allowlist in Dashboard → Real Estate → Website forms.

The private `api/real-estate-automation.ts` Vercel Schedule runs every 15 minutes in the `Africa/Lagos` timezone. It uses Vercel's private `schedule/v1beta` trigger, so there is no public worker URL or cron bearer secret to expose. The handler deliberately skips Preview deployments because Preview and Production currently share a Supabase project; only Production may process real leads. It runs the pipeline and due follow-ups through the same leased, idempotent workers. The 15-minute cadence stays within the current Hobby Schedules allowance and gives up to roughly 15 minutes of scheduler delay for a due follow-up. Keep the older bearer-protected `/api/cron/real-estate-automation` route fail-closed as an operator fallback; do not enable a second scheduler against the same database.

The worker is safe to invoke more than once: leads and follow-up rows are claimed with database leases, each provider send uses a stable idempotency key, and only the worker holding the current lease may finalize an attempt. Resend acceptance is recorded separately from confirmed delivery; delivery, bounce, open and click states require a configured Resend event webhook.

## Four real-estate automation lanes

The real-estate workspace exposes the four automation paths through Lead Management, Operations and the active Playbook. The customer-facing flow remains a draft until an agency connects and tests its providers, selects the right workspace connections, approves each external operation, and enables the server-side gates.

1. **Instant Speed-to-Lead & Qualification (WhatsApp + Email + Web Forms).** Website forms, authenticated lead creation and webhook/manual triggers create one idempotent enquiry. The durable pipeline runs Gemini qualification, deterministic lead scoring and Playbook rules, creates the back-office review task, and sends the approved agency summary through the Resend Email operation. WhatsApp is an optional customer action, not an automatic fallback: it requires the lead's WhatsApp contact preference, timestamped consent text that explicitly names WhatsApp, a valid E.164 number, an approved Meta template, a selected tested workspace connection, operation approval and the explicit provider live gate. No free-form WhatsApp sends are allowed.
2. **Automated Property Inspection & Calendar Booking.** Operations checks the selected tested Google Calendar for overlapping events and Rexnora bookings, reserves a workspace booking, and waits for a distinct owner/admin approval before creating the Calendar event. Customer invitations are off unless the agency explicitly requests one and email consent is present. A deterministic event ID and Google get_event reconciliation prevent duplicate event creation after a lost response. The booking and its preparation task are recorded.
3. **Long-Term Buyer & Investor Follow-Up Drip.** Gemini qualification drafts five email checkpoints (immediately, 1 day, 7 days, 30 days and 90 days). The queue is created only for a customer who supplied timestamped email consent and an email address. Every send rechecks consent and stops after withdrawal, customer response, agent takeover, or a won/lost lead. Resend acceptance is recorded separately from confirmed delivery.
4. **Back-Office Automation.** Qualification creates a deduplicated enquiry-review task; a confirmed inspection creates a preparation task. A Playbook may also sync one selected CRM (Pipedrive, Zoho CRM or Freshsales): it must search by the exact email before creating, reuse the same tested connection, and have separate approved operation permissions. CRM matches, creations, failures and uncertain outcomes are written to the CRM sync ledger and lead activity history. Ambiguous results and uncertain creates require review; Rexnora never blindly creates a duplicate.

## Runtime gates and provider setup

- The production scheduler requires `AIVANTA_LIVE_EXECUTION_ENABLED=true` and `REAL_ESTATE_PIPELINE_ENABLED=true` for lead processing. The 90-day service separately requires `REAL_ESTATE_FOLLOWUPS_ENABLED=true`.
- External provider actions require the exact provider ID in `AIVANTA_LIVE_INTEGRATIONS` (for example, `whatsapp_business,pipedrive`). Add only providers the agency has connected and explicitly approved. Do not set a global wildcard.
- Connect and successfully test Gemini and Resend in the same workspace. Add the designated agency notification inbox to the approved recipient allowlist. Approve `gemini / qualify_real_estate_lead` and `email / send_email`.
- For WhatsApp, connect and test WhatsApp Business, configure an approved template, choose the connection on the Playbook action, and approve `whatsapp_business / send_template`. Live delivery remains skipped/blocked unless the customer consent record is channel-specific.
- For inspection booking, connect and test a Google Calendar account that owns the target calendar. The connection must grant the owned-calendar scope. The booking flow requests a separate owner/admin approval before it creates an event.
- For CRM, connect and test exactly one provider per Playbook. Select the same workspace connection for `search_contacts` and `execute`; approve both operations. Exact-email search always precedes create.
- Configure the server-only Supabase service-role/secret key and credential-encryption key. Never expose either with a `NEXT_PUBLIC_` variable. Workspace credentials remain encrypted and server-side.
- The private `api/real-estate-automation.ts` Vercel Schedule runs every 15 minutes in the `Africa/Lagos` timezone and deliberately skips Preview deployments because Preview and Production currently share a Supabase project. Keep the older bearer-protected `/api/cron/real-estate-automation` route fail-closed; do not enable a second scheduler against the same database.

The pipeline uses durable claims and idempotency keys. Rate limits are eligible for bounded retry; provider timeouts or lost responses become an `unknown` outcome and require reconciliation rather than an automatic resend or duplicate create. Calendar retries use the same event ID and fetch the event before another create attempt. The system records provider acceptance, not guaranteed delivery. Delivery, bounce, open and click states require a configured Resend event webhook.

## Current release boundary

The code paths and schema are in the integration branch, but they are **not yet a live customer acceptance result**. Staging still needs the additive RPC and CRM/retry migrations applied through the reviewed migration process; branch Preview credentials need to be configured; and the agency workspace still needs verified Gemini, Resend, Google Calendar, WhatsApp Business and/or CRM connections plus action approvals. Do not enable production live flags or contact real customers until the complete enquiry-to-outcome flow passes with agency-approved test data. No paying agency or payment is recorded yet.

## Acceptance checks to run

1. Submit a website enquiry with a new idempotency key. Confirm one lead appears, Gemini qualification and deterministic score are persisted, an agency decision/notification is recorded, and the enquiry-review task is created.
2. Resubmit the same source/event key. Confirm the existing lead is returned and no duplicate lead, task, CRM contact or follow-up sequence is created.
3. Test WhatsApp with no consent, email-only consent, invalid phone, missing template, unapproved operation, and a valid timestamped WhatsApp consent. Only the last fully configured case may call Meta. Simulate 429 and unknown provider outcomes; confirm bounded retry for 429 and no blind resend for unknown.
4. Reserve an inspection slot, verify overlaps are rejected, approve as owner/admin, and confirm one Google Calendar event plus one preparation task. Simulate a lost create response and confirm the same event ID is fetched/reconciled before retry.
5. Run CRM exact-email search with zero, one, duplicate and unverified matches. Confirm create only follows zero exact matches and its separate approval; uncertain create outcomes must be reconciled before any retry.
6. Confirm the five follow-up checkpoints are created only for timestamped email consent, and are cancelled after withdrawal, customer response, agent takeover or a won/lost status.
7. Run two scheduler invocations concurrently. Confirm no duplicate provider sends or CRM creates and that each claimed row is completed, retried within its bound, or sent to review.
8. Try to read another workspace's lead, property, form, activity, task, booking, CRM sync and follow-up. Confirm RLS returns no data.
9. Verify the full live flow—enquiry → Gemini → qualification → approval → communication → follow-up → recorded outcome—in a dedicated staging workspace with agency-approved test data and verified provider connections.
