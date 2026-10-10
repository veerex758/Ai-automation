# Aivanta

AI-powered business automation for teams that want clear, dependable workflows and thoughtfully applied AI.

## Current status

This repository contains the application foundation, authenticated workflow storage, a visual builder, automated validation tests, and a persisted dry-run execution path. Dry-runs simulate steps and record history without sending emails, posting messages, creating external tasks, or making HTTP requests. Live execution, third-party integrations, billing, and production hardening remain in progress; see [the roadmap](docs/ROADMAP.md) for the staged plan.

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
