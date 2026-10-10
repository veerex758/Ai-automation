# Aivanta authentication setup

Aivanta uses Supabase Auth with the SSR package. This setup is scoped to the dedicated Aivanta project only.

## Required environment variables

Copy `.env.example` to `.env.local` and set:

- `NEXT_PUBLIC_SUPABASE_URL`: the Aivanta project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key from Supabase API settings.

Do not use a service-role key in browser or public environment variables. Never commit `.env.local`.

## Supabase Auth URL configuration

In the Aivanta Supabase dashboard, open Authentication URL configuration and set the site's production URL. Add local development and deployed app URLs to the redirect allow-list, including:

- `http://localhost:3000/auth/callback`
- `https://YOUR_DEPLOYMENT_HOST/auth/callback`

Replace the deployment placeholder with the actual host before adding it. The sign-up flow requests confirmation via `/auth/callback?next=/dashboard`.

## Implemented in this branch

- Browser and server Supabase client helpers using `@supabase/ssr`.
- Session refresh and protected `/dashboard` routes in Next.js middleware.
- Premium responsive sign-in / sign-up page at `/login`.
- PKCE confirmation callback and POST-only sign-out route.
- Default workspace provisioning for new Auth users via a restricted database trigger, with a server-side fallback for existing accounts.
- Authenticated `GET` and `POST /api/workflows` endpoints backed by RLS-protected Supabase tables.
- Dashboard workflow loading and draft creation now persist in the dedicated Aivanta database.
- Publishable-key-only environment template.

## Still to complete

- Workflow editing/deletion UI and end-to-end authorization tests.
- Password reset, production deployment configuration, and end-to-end sign-up testing with the real redirect allow-list.
- Workflow execution and connected-service integrations.

Workflow listing and draft creation are now database-backed. Execution and integrations are not implemented by these changes.
