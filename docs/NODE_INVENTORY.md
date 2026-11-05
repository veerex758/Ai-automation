# Aivanta node inventory — source of truth

This inventory separates executable workflow definitions from the provider directory. These are different counts and must not be reported as one total.

## Authoritative counts

| Inventory | Count | Meaning |
|---|---:|---|
| Native executable registry | 104 | Definitions in `nodes/registry.ts`; these are the only nodes exposed to the AI planner and execution validator |
| Provider directory | 100 | User-facing integrations/providers listed in `nodes/provider-catalog.ts` |
| Provider directory mapped to native implementations | 84 | Directory entries whose `registryId` resolves to a native registry definition |
| Provider directory not yet mapped | 16 | Directory entries with no native implementation; displayed as `coming_soon` |
| Internal utility-pack nodes | 20 | Executable utility definitions included in the 104-node registry but not represented as separate provider-directory entries |
| Provider-pack nodes | 20 | Executable provider adapters included in the 94-node registry |
| Catalogue AI provider nodes | 4 | ElevenLabs, Stability AI, Hugging Face and Pinecone; each has a schema-backed action |
| CRM and messaging catalogue nodes | 8 | Microsoft Teams, Salesforce, Pipedrive, Zoho CRM, Freshsales, Close, Apollo and Intercom |
| Google read-only catalogue nodes | 6 | Drive, Calendar, Docs, Forms, YouTube and Contacts |
| Productivity/developer catalogue nodes | 9 | Jira, Asana, Trello, ClickUp, Monday.com, Todoist, Airtable, Bitbucket and Netlify |
| Commerce/support catalogue nodes | 10 | WooCommerce, PayPal, Paddle, Lemon Squeezy, Square, Razorpay, Zoom, Cal.com, Twilio Voice and DocuSign |

The 104 native definitions are composed of 27 core, integration and data definitions, 20 utility-pack definitions, 20 provider-pack definitions, 4 catalogue AI provider definitions, 8 CRM/messaging catalogue provider definitions, 6 Google read-only provider definitions, 9 productivity/developer provider definitions, and 10 commerce/support provider definitions.

## Resolving the former “73 nodes” figure

The repository source at the audited revision did not contain a 73-entry executable registry. After this provider batch, the authoritative count is 104 executable definitions and 100 provider-directory entries. The former 73 figure is therefore not a valid implementation count and must not be used for progress reporting. The 104-node count now includes 37 additional provider implementations added after the original 67-node audit. The old 73 figure was never a reliable registry count.

Do not add placeholder nodes merely to make the old number match. A node counts as executable only when it is registered in `nodes/registry.ts` with validated input/output schemas and a server-side handler.

## Reporting rules

- Say **104 executable nodes** when referring to the native workflow registry.
- Say **100 directory entries: 84 mapped, 16 coming soon** when referring to the provider directory.
- Do not describe all 84 mapped providers as live-production-ready. Registration and schema-backed handlers do not by themselves prove credentials, provider contracts, live-action authorization, or successful real-service execution.
- Keep these counts protected by `tests/provider-catalog.test.ts`.
