-- Add MySQL and MongoDB to the encrypted workspace credential allowlist.
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
    'jira','asana','trello','clickup','monday','todoist','airtable','bitbucket','netlify',
    'woocommerce','paypal','paddle','lemon_squeezy','square','razorpay','zoom','cal_com','twilio_voice','docusign',
    'x_twitter','linkedin','facebook_pages','instagram','tiktok','mailchimp','typeform',
    'supabase','postgresql','mysql','mongodb','redis','firebase','dropbox','aws_s3','cloudflare_r2'
  ));

-- This narrow server-only RPC prevents database credentials from expanding the
-- general API-key provider save path.
create or replace function public.save_workspace_database_credentials(
  p_workspace_id uuid,
  p_provider text,
  p_display_name text,
  p_encrypted_credential text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_integration_id uuid;
begin
  if p_provider not in ('mysql', 'mongodb') then
    raise exception 'Unsupported database credential provider';
  end if;

  if p_display_name is null or length(trim(p_display_name)) = 0 or length(p_display_name) > 120 then
    raise exception 'Invalid database connection display name';
  end if;

  if p_encrypted_credential is null or length(p_encrypted_credential) = 0 then
    raise exception 'Encrypted database credential is required';
  end if;

  insert into public.workspace_integrations (
    workspace_id, provider, status, display_name, metadata, created_by
  )
  values (
    p_workspace_id, p_provider, 'needs_attention', trim(p_display_name), '{}'::jsonb, null
  )
  on conflict (workspace_id, provider) do update
    set display_name = excluded.display_name,
        status = 'needs_attention',
        last_tested_at = null,
        last_test_status = null,
        updated_at = now()
  returning id into v_integration_id;

  insert into public.workspace_integration_secrets (
    integration_id, encrypted_credentials, encryption_version, updated_at
  )
  values (
    v_integration_id, p_encrypted_credential, 'v1', now()
  )
  on conflict (integration_id) do update
    set encrypted_credentials = excluded.encrypted_credentials,
        encryption_version = excluded.encryption_version,
        updated_at = now();

  return v_integration_id;
end;
$$;

revoke all on function public.save_workspace_database_credentials(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_workspace_database_credentials(uuid, text, text, text) to service_role;
