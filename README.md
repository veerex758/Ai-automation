# Aivanta

AI-powered business automation for teams that want clear, dependable workflows and thoughtfully applied AI.

## Current status

This repository contains the application foundation, authenticated workflow storage, a visual builder, automated validation tests, and a persisted dry-run execution path. The first live integration is Resend email, guarded by server-only configuration, active workflows, manual triggers, a single email action per run, and idempotency keys. Live execution remains disabled unless `AIVANTA_LIVE_EXECUTION_ENABLED=true` is explicitly configured on the server. See [the integration setup guide](docs/integrations/resend.md) and [the roadmap](docs/ROADMAP.md).

## Stack

- Next.js App Router
- React and TypeScript
- CSS design system with responsive layouts
- PostgreSQL connection foundation (`pg`)

## Database foundation

The Supabase-backed schema and setup notes are in [`db/`](db/README.md). Configure Supabase URL and publishable key through environment variables; never commit secrets. Workflow and run-history APIs require an authenticated session and use workspace-scoped Row Level Security.

## Local development

Requirements: Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Project principles

Security-minded architecture, tenant isolation, least-privilege integrations, validated workflow definitions, and honest status reporting are core requirements. Never commit secrets or real customer credentials.
