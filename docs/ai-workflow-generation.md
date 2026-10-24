# AI workflow generation

Aivanta has an authenticated AI draft-generation endpoint at `POST /api/ai/generate-workflow` and a builder preview/review panel.

## Provider configuration

Configure these as server-side environment variables in the intended environment:

- `AIVANTA_AI_API_KEY` — required API key. `OPENAI_API_KEY` is accepted as a compatibility fallback.
- `AIVANTA_AI_BASE_URL` — optional OpenAI-compatible API base URL; defaults to `https://api.openai.com/v1`. Production configuration requires HTTPS.
- `AIVANTA_AI_MODEL` — optional model identifier; defaults to `gpt-4o-mini`.

Never prefix the AI API key with `NEXT_PUBLIC_`, commit it, or put it in browser code. Configure staging and production separately. Do not copy production credentials into staging.

## Request and review lifecycle

1. The endpoint requires an authenticated Supabase user.
2. It rejects malformed/oversized request bodies and prompts longer than 2,000 characters.
3. The server asks the configured provider for a JSON workflow draft.
4. The response must be JSON with the expected root and node shape, then passes the shared workflow definition validator.
5. The builder displays the result as a preview. The user can discard it or apply it to the canvas.
6. Generation does not save, activate, or execute a workflow. Saving from the builder currently stores a local browser draft; server-persisted authenticated save/restore is a separate acceptance item.

## Safety boundaries

- User text is treated as workflow intent, not as authority to change system rules.
- Unknown root/node fields are rejected; the shared validator checks supported trigger, node, action, and setting values.
- External action destinations/credentials must not be invented. Generated email recipients may be placeholders and must be reviewed.
- A valid draft is not proof that a provider is connected or that a live action can run.
- Live execution, OAuth, and external integration acceptance remain gated. Do not run staging or live tests without explicit authorization.

## Test coverage and limits

The AI generator tests use a mocked fetch/provider response. They cover prompt limits, missing credentials, malformed responses, provider errors/timeouts, schema validation, and draft-only return flags. They do not call a real AI provider or prove real provider credentials/configuration work.

Before enabling AI for users, privately configure the server-side key, confirm the chosen provider/model is approved, then perform authenticated staging acceptance only after the user explicitly resumes live testing. Never place key values in issue comments or test output.
