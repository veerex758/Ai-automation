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

Apply the migrations in order: `20261120100000_real_estate_lead_management.sql`, `20261120102000_real_estate_followup_controls.sql`, `20261120103000_real_estate_followup_recovery.sql`, `20261120104000_real_estate_pipeline_delivery.sql`, then `20261122110000_real_estate_notification_recipients.sql` through the reviewed Supabase migration process. The migrations have not been applied to production by this pull request.

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

## Current deliberate boundaries

- The registered WhatsApp Business adapter now supports approved-template sends with optional workspace defaults and explicit live-operation approval. The native real-estate pipeline still does not dispatch WhatsApp follow-ups: a channel-specific consent check and durable send ledger are required before enabling customer messaging. The automated nurture queue remains email-only.
- Google Calendar now has a registered `create_event` operation using the `calendar.events.owned` scope, with invitee notifications off by default. The native real-estate screen does not yet offer appointment-slot availability, booking confirmation or an appointment ledger; do not advertise automated inspection booking as complete. Google Sheets remains read-only in the current contract.
- Public intake and authenticated lead creation enqueue and invoke the durable Gemini qualification pipeline. Gemini output, deterministic score, summary, suggested reply, activity and status are persisted under a workspace-scoped lease. The complete behavior still needs an authenticated staging acceptance run with a verified Gemini connection and approved operation.
- The five-step, 90-day follow-up sequence is generated from the structured Gemini qualification response and persisted only for customers who explicitly consented to email follow-ups and supplied an email address. Steps are scheduled immediately, after 1 day, 7 days, 30 days and 90 days. Delivery remains blocked until a verified Resend connection and approved operation exist.
- Resend API acceptance is recorded. Delivery, bounce, open and click states require a configured Resend event webhook before they can be reported as provider-confirmed delivery.
- Back-office visibility currently includes workspace-scoped lead/property records, assignment, lead activities, match history and agency email alerts. CRM writes and inspection-event persistence are not yet wired into the real-estate pipeline, even though generic CRM provider actions are available in the integration catalogue.
- Customer privacy notice, retention schedule, agency approval and live provider acceptance must be completed before real customer onboarding.

## Acceptance checks to run

1. Submit a website enquiry with a new idempotency key. Confirm one lead appears and five follow-ups are created only when consent and email preference allow it.
2. Resubmit the same source/event key. Confirm the existing lead is returned and no second lead/follow-up sequence is created.
3. Withdraw consent, mark the customer as responded, change status to contacted or assign an agent takeover. Confirm pending follow-ups are cancelled.
4. Add a listing and confirm it can match; change it to sold or allow its verification timestamp to become more than seven days old and confirm it is excluded.
5. Run two cron invocations concurrently. Confirm no duplicate provider send occurs and that each claimed row is completed or retried.
6. Try to read another workspace's lead, property, form, activity and follow-up. Confirm RLS returns no data.
7. Verify actual Gemini and Resend behavior in a dedicated staging workspace using agency-approved test data and approved recipients.
