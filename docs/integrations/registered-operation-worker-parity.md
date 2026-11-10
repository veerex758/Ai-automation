# Registered operation vs durable worker parity audit

**Audited ref:** `feat/integrations-directory-100`  
**Audited commit:** `1c80d9f1706b3ba0d5b6bbe7fb3018061f8f897d`  
**Scope:** native registry definitions, operation IDs, durable-worker provider resolution, credential lookup, and live-step gates.

## Result

- **98/98 catalogue entries with native definitions** have a worker-side provider/operation route.
- **20/20 internal utility definitions** have an intentional execution path: 19 deterministic utility actions are in the durable live-safe allowlist; Error Trigger is a trigger and is dispatched through the error-event queue path.
- **2/100 catalogue entries are intentionally unmapped:** MySQL and MongoDB remain Coming Soon. They have no native registered operation and no worker adapter. They must not be counted as implemented.
- No registered catalogue operation was found that falls through to the worker's unknown-provider/unknown-operation rejection in the audited source revision.

This is a source-level parity audit, not proof of authenticated provider acceptance. Mock tests and static routing checks do not establish real-account OAuth, provider permissions, rate-limit behavior, or staging E2E success.

## Operation routing

| Registry family | Worker routing | Notes |
| --- | --- | --- |
| OpenAI, Gemini, Slack, Email/Resend | Explicit node + operation mapping | Provider-specific live opt-in; Email additionally requires recipient allowlist |
| Gmail, Google Sheets | Explicit operation mapping | Sheets registry node uses credential namespace `sheets`; Gmail uses `gmail` |
| Google Drive, Calendar, Docs, Forms, YouTube, Contacts | Explicit node + supported operation mapping | Credentials resolve through managed Google product connections |
| Notion, HubSpot, Twilio, Shopify, Stripe, Linear | Explicit node + operation mapping | Twilio SMS has an E.164 recipient allowlist |
| Claude, Mistral, Groq, Perplexity, Discord, Telegram, WhatsApp Business, SendGrid, Mailgun, Postmark, GitHub, GitLab, Sentry, Vercel, Calendly, Zendesk, Freshdesk, SerpAPI, OpenWeather, RSS Feed | Provider-pack mapping | Generic `execute` routes, plus the named extra operations below |
| ElevenLabs, Stability AI, Hugging Face, Pinecone | Explicit provider mapping | Catalogue AI pack |
| Microsoft Teams, Salesforce, Pipedrive, Zoho CRM, Freshsales, Close, Apollo, Intercom | Explicit provider mapping | CRM pack includes provider-specific lookup operations below |
| Jira, Asana, Trello, ClickUp, Monday, Todoist, Airtable, Bitbucket, Netlify | Explicit provider mapping | Productivity pack |
| WooCommerce, PayPal, Paddle, Lemon Squeezy, Square, Razorpay, Zoom, Cal.com, Twilio Voice, DocuSign | Explicit provider mapping | Commerce/support pack; voice calls have a recipient allowlist |
| X/Twitter, LinkedIn, Facebook Pages, Instagram, TikTok, Mailchimp, Typeform | Explicit provider mapping | Public publishing requires a separate global publishing gate |
| Supabase, PostgreSQL, Redis, Firebase, Dropbox, AWS S3, Cloudflare R2 | Explicit provider mapping | Database/storage pack; PostgreSQL uses the `pg` driver; MySQL and MongoDB are absent |
| HTTP Request | Maps `http_request.request` to credential namespace `http` | Uses the shared SSRF-safe HTTP transport |
| IF, Switch, Merge, Set Fields, JSON Parse, Filter, Aggregate, Date/Time, Loop, Wait, and utility pack | Deterministic internal-action allowlist | No external provider credential required |
| Manual, Schedule, Error Trigger | Trigger-specific handling | Webhook trigger is accepted for dry-run/ingress but durable live webhook execution is deliberately rejected |

## Non-generic operation IDs checked

The worker has explicit support for the following non-`execute` operations:

- Gmail: `list_messages`, `get_message`
- Google Sheets: `get_values`, `get_spreadsheet`
- Notion: `create_page`
- HubSpot: `create_contact`, `search_contacts`
- Twilio: `send_sms`; Shopify: `list_products`; Stripe: `create_customer`; Linear: `create_issue`
- Google Drive: `get_file`; Calendar: `get_event`; Docs: `get_document_text`; YouTube: `get_video`; Contacts: `get_person`; Forms: `execute`
- Discord: `get_channel`; Telegram: `get_chat`; WhatsApp Business: `get_phone_number`
- Salesforce: `search_leads`; Pipedrive, Zoho CRM, Freshsales, Apollo, and Intercom: `search_contacts`; Close: `get_contact`
- Supabase: `get_row`; PostgreSQL: `get_database_info`; Redis: `get_many`; Firebase: `get_document`; Dropbox: `get_file_metadata`; AWS S3 and Cloudflare R2: `get_object_metadata`
- Internal deterministic actions: `evaluate`, `select_route`, `merge_inputs`, `merge_fields`, `parse`, `filter_items`, `calculate`, `current_time`, `iterate`, `delay`, plus the 19 utility-pack action IDs listed in `liveStepAllowed`.

## Important distinctions

1. **Registered is not the same as live-enabled.** A provider route can be present while its exact provider ID is absent from `AIVANTA_LIVE_INTEGRATIONS`; in that case live execution fails closed.
2. **Credential readiness is a separate gate.** Non-Google providers require a workspace connection with `status=connected` and `last_test_status=passed`; Google products resolve through the managed Google connection store and required-scope check.
3. **High-impact actions have additional gates.** Email/SMS/voice recipient allowlists and social publishing approval are checked separately.
4. **Webhook live execution remains blocked.** This is an intentional safety restriction, not a missing adapter.
5. **MySQL and MongoDB are real gaps.** No registry definitions, operation handlers, driver imports, or worker provider routes were found for either provider.

## Follow-on work

The next implementation sequence can proceed from this baseline: implement MySQL/MongoDB native drivers and definitions, then complete non-Google OAuth authorization/refresh, then add persistent workspace approvals and enforce them before live execution. Authenticated staging acceptance remains outstanding.

## Verification boundary

This audit was performed by reading the registry, provider catalogue, node-pack definitions, durable-worker routing, provider live-gate helper, and existing provider/database tests at the audited ref. The repository connector in this session does not provide a working checkout/terminal, so no local lint, type-check, test, build, or authenticated staging command was run as part of this audit. CI must still be checked after this report is committed.
