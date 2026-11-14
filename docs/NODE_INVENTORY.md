# Aivanta node inventory — source of truth

This inventory distinguishes executable workflow definitions from the user-facing provider directory. They are separate counts.

## Authoritative source counts

| Inventory | Count | Meaning |
|---|---:|---|
| Native executable registry | 122 | Definitions exported by `nodes/registry.ts`; the AI planner and execution validator use this registry |
| Provider directory | 100 | User-facing integrations listed by `nodes/provider-catalog.ts` |
| Directory entries with native implementations | 100 | Every directory entry resolves to a registered implementation |
| Coming-soon directory entries | 0 | No provider-directory entry is currently marked coming soon |
| Internal utility-pack nodes | 20 | Executable utility definitions outside the provider directory |
| Provider-pack nodes | 20 | Executable provider adapters |
| Catalogue AI provider nodes | 4 | ElevenLabs, Stability AI, Hugging Face and Pinecone |
| CRM and messaging catalogue nodes | 8 | Microsoft Teams, Salesforce, Pipedrive, Zoho CRM, Freshsales, Close, Apollo and Intercom |
| Google read-only catalogue nodes | 6 | Drive, Calendar, Docs, Forms, YouTube and Contacts |
| Productivity/developer catalogue nodes | 9 | Jira, Asana, Trello, ClickUp, Monday.com, Todoist, Airtable, Bitbucket and Netlify |
| Commerce/support catalogue nodes | 10 | WooCommerce, PayPal, Paddle, Lemon Squeezy, Square, Razorpay, Zoom, Cal.com, Twilio Voice and DocuSign |
| Social/marketing catalogue nodes | 7 | X/Twitter, LinkedIn, Facebook Pages, Instagram, TikTok, Mailchimp and Typeform |
| Database/storage catalogue nodes | 9 | Supabase, PostgreSQL, MySQL, MongoDB, Redis, Firebase/Firestore, Dropbox, AWS S3 and Cloudflare R2 |
| Core, integration and data definitions | 29 | Core trigger, data transformation, logic and execution primitives outside the provider/utility packs above |

The 122-node count is protected by `tests/provider-catalog.test.ts`. The test also asserts that all 100 provider-directory entries are registered, including MySQL and MongoDB, and that every registered operation has exactly one worker mapping.

## Reporting rules

- Say **122 executable nodes** for the native workflow registry.
- Say **100 provider-directory entries; 100 registered; 0 coming soon** for the provider directory.
- Do not describe all 100 providers as live-production-verified. Registration, schemas, worker mappings and database-container integration tests do not prove OAuth consent, credentials, provider-side permissions, or successful authenticated staging execution.
- Use `tests/worker-operation-parity.test.ts` as the operation-to-worker parity gate.
- MySQL and MongoDB have native implementations and real database-driver integration tests. Their external staging credentials and authenticated product acceptance remain separate release gates.
