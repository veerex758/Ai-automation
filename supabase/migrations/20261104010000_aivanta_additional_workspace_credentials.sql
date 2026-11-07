-- Expand workspace-scoped credential storage for the additional registry integrations.
-- This only widens the provider allowlist; existing workspace rows and encrypted secrets are untouched.
alter table public.workspace_integrations
  drop constraint if exists workspace_integrations_provider_check;

alter table public.workspace_integrations
  add constraint workspace_integrations_provider_check
  check (provider in (
    'openai','gemini','resend','slack','http',
    'notion','discord','telegram','airtable','trello','hubspot'
  ));
