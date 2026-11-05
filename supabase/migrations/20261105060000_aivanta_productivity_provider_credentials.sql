-- Expand the native provider credential allowlist for the four AI and eight CRM/messaging catalogue providers.
-- This is a forward-only, reviewed migration; it has not been applied to any database.
alter table public.workspace_integrations
  drop constraint if exists workspace_integrations_provider_check;

alter table public.workspace_integrations
  add constraint workspace_integrations_provider_check
  check (provider in (
    'openai','gemini','resend','slack','http','notion','hubspot','twilio','shopify','stripe','linear',
    'claude','mistral','groq','perplexity','discord','telegram','whatsapp_business',
    'sendgrid','mailgun','postmark','github','gitlab','sentry','vercel','calendly',
    'zendesk','freshdesk','serpapi','openweather',
    'elevenlabs','stability_ai','hugging_face','pinecone',
    'microsoft_teams','salesforce','pipedrive','zoho_crm','freshsales','close','apollo','intercom',
    'jira','asana','trello','clickup','monday','todoist','airtable','bitbucket','netlify'
  ));

create or replace function public.save_workspace_integration_credentials(
  p_workspace_id uuid,
  p_provider text,
  p_display_name text,
  p_encrypted_credentials text,
  p_created_by uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare integration_id uuid;
begin
  if p_provider is null or p_provider not in (
       'openai','gemini','resend','slack','http','notion','hubspot','twilio','shopify','stripe','linear',
       'claude','mistral','groq','perplexity','discord','telegram','whatsapp_business',
       'sendgrid','mailgun','postmark','github','gitlab','sentry','vercel','calendly',
       'zendesk','freshdesk','serpapi','openweather',
       'elevenlabs','stability_ai','hugging_face','pinecone',
       'microsoft_teams','salesforce','pipedrive','zoho_crm','freshsales','close','apollo','intercom',
       'jira','asana','trello','clickup','monday','todoist','airtable','bitbucket','netlify'
     )
     or p_display_name is null or length(trim(p_display_name)) not between 1 and 120
     or p_encrypted_credentials is null or length(p_encrypted_credentials) not between 32 and 65536
     or p_created_by is null then
    raise exception using errcode = '22023', message = 'Invalid workspace integration request';
  end if;

  if not exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = p_created_by
  ) and not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = p_created_by
      and wm.role in ('owner','admin')
  ) then
    raise exception using errcode = '42501', message = 'Workspace administrator permission required';
  end if;

  insert into public.workspace_integrations (
    workspace_id, provider, status, display_name, created_by, updated_at
  ) values (
    p_workspace_id, p_provider, 'connected', trim(p_display_name), p_created_by, now()
  )
  on conflict (workspace_id, provider) do update
    set status = 'connected', display_name = excluded.display_name, updated_at = now()
  returning id into integration_id;

  insert into public.workspace_integration_secrets (
    integration_id, encrypted_credentials, encryption_version, updated_at
  ) values (
    integration_id, p_encrypted_credentials, 'v1', now()
  )
  on conflict (integration_id) do update
    set encrypted_credentials = excluded.encrypted_credentials,
        encryption_version = excluded.encryption_version,
        updated_at = now();

  return jsonb_build_object(
    'id', integration_id, 'provider', p_provider,
    'display_name', trim(p_display_name), 'status', 'connected', 'updated_at', now()
  );
end;
$$;

revoke all on function public.save_workspace_integration_credentials(uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.save_workspace_integration_credentials(uuid,text,text,text,uuid)
  to service_role;
