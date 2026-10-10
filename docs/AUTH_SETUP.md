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
- Publishable-key-only environment template.

## Not yet complete

- Creating a default workspace on first sign-in.
- Loading workflows from Supabase instead of the dashboard's clearly labelled prototype/browser storage.
- Workspace CRUD APIs, authorization tests, password reset, and production deployment configuration.

Those are separate implementation and verification steps; this branch does not claim that database-backed workflow CRUD is already live.
