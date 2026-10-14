# Aivanta API foundation

## Workflow validation

`POST /api/workflows/validate` validates a workflow definition on the server using the shared rules in `lib/workflows/validation.ts`.

- Requires a valid authenticated Supabase session; unauthenticated requests receive `401`.
- Send a JSON workflow object with a `name` and a `steps` array.
- Returns `200` with `{ "valid": true, "issues": [] }` when valid.
- Returns `422` with structured validation issues when the definition is invalid.
- Returns `400` for malformed JSON, `413` for a request body over 1 MB, and `415` for a non-JSON content type.
- Responses use `Cache-Control: no-store`.
- Validation-only: it does not save data, call external providers, or execute workflows.

Persistent CRUD/versioning, integrations, and execution must be implemented and tested before production activation. Add tenant authorization when the endpoint starts accessing workspace-owned resources. Do not treat this endpoint as a production-ready workflow creation API.
