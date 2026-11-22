# Real-estate lead management template

This is the first customer-facing industry template built on Rexnora's workspace-scoped execution foundation.

## Implemented capabilities

- Public enquiry forms use a high-entropy one-time public key. Only its SHA-256 hash is stored.
- Form submissions must come from an explicitly allowed origin, include a unique Idempotency-Key, pass a workspace/IP rate limit and contain a name, contact method and explicit contact-consent choice.
- Lead records are workspace-scoped and retain source, intent, property requirements, budget, timeline, finance readiness, consent, qualification, deterministic score, status and timestamps.
- Lead scoring is calculated in application code from explainable factors. Gemini does not choose the numeric score.
- Agent assignment verifies that the agent is in the same workspace.
- Property matching only returns active listings marked available whose price and location are stored and whose availability was verified within the last seven days.
- Follow-up checkpoints are persisted for immediately, 1 hour, 24 hours, 3 days and 7 days, only for a consenting customer who selected email and supplied an email address.
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

- Configure CRON_SECRET on the server.
- Set REAL_ESTATE_FOLLOWUPS_ENABLED=true and AIVANTA_LIVE_EXECUTION_ENABLED=true server-side.
- Connect and successfully test Resend in the same workspace. The worker decrypts only that workspace's credential envelope.
- Approve the resend / email / send_email operation for the workspace.
- Configure a scheduler to invoke GET /api/cron/real-estate-followups with Authorization: Bearer CRON_SECRET at least every 5 minutes.

Vercel Hobby Cron is daily and cannot meet the 1-hour and 24-hour timing in this template. The root `vercel.json` intentionally does not register this frequent job. Configure an external scheduler to call `GET /api/cron/real-estate-automation` with `Authorization: Bearer CRON_SECRET` at least every five minutes. The endpoint runs the lead pipeline and due follow-ups; it is safe to invoke repeatedly because work is claimed with database leases and provider idempotency keys. A 15-minute or daily schedule is not sufficient for the stated follow-up sequence.

The endpoint is safe to invoke more than once: rows are claimed with leases, every follow-up has a stable Resend idempotency key, and only the worker holding the current lease may finalize the attempt. A network timeout is retried with the same provider idempotency key.

## Current deliberate boundaries

- WhatsApp delivery is not enabled. The data model records the requested contact preference, but the automated follow-up queue currently sends email only.
- Google Sheets export and Google Calendar viewing appointments are not part of this pilot slice.
- AI qualification is available as a registered Gemini workflow action in Rexnora. The intake endpoint currently stores structured customer-provided requirements and its deterministic score; the complete intake-to-Gemini-to-persisted-lead orchestration still needs to be connected and verified as one durable workflow before this is a signed-off pilot.
- Message templates are personalized with stored lead details, but the five-step follow-up sequence is not yet generated by Gemini.
- Resend API acceptance is recorded. Delivery, bounce, open and click states require a configured Resend event webhook before they can be reported as provider-confirmed delivery.
- Customer privacy notice, retention schedule, agency approval and live provider acceptance must be completed before real customer onboarding.

## Acceptance checks to run

1. Submit a website enquiry with a new idempotency key. Confirm one lead appears and five follow-ups are created only when consent and email preference allow it.
2. Resubmit the same source/event key. Confirm the existing lead is returned and no second lead/follow-up sequence is created.
3. Withdraw consent, mark the customer as responded, change status to contacted or assign an agent takeover. Confirm pending follow-ups are cancelled.
4. Add a listing and confirm it can match; change it to sold or allow its verification timestamp to become more than seven days old and confirm it is excluded.
5. Run two cron invocations concurrently. Confirm no duplicate provider send occurs and that each claimed row is completed or retried.
6. Try to read another workspace's lead, property, form, activity and follow-up. Confirm RLS returns no data.
7. Verify actual Gemini and Resend behavior in a dedicated staging workspace using agency-approved test data and approved recipients.
