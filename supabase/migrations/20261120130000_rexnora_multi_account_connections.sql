-- Multiple named accounts per provider, with step-level connection IDs.
-- Secrets remain server-only and every save is scoped to a workspace administrator.
alter table public.workspace_integrations
  drop constraint if exists workspace_integrations_workspace_id_provider_key;

create index if not exists workspace_integrations_workspace_provider_created_idx
  on public.workspace_integrations (workspace_id, provider, created_at desc);

alter table public.google_connections
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_test_status text
    check (last_test_status in ('passed', 'failed'));

create or replace function public.save_workspace_integration_connection(
  p_workspace_id uuid,
  p_provider text,
  p_display_name text,
  p_encrypted_credentials text,
  p_created_by uuid,
  p_connection_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
  v_now timestamptz := now();
begin
  if p_workspace_id is null
     or p_provider is null
     or p_provider not in (
       'openai','gemini','resend','slack','http','notion','hubspot','twilio','shopify','stripe','linear',
       'claude','mistral','groq','perplexity','discord','telegram','whatsapp_business',
       'sendgrid','mailgun','postmark','github','gitlab','sentry','vercel','calendly',
       'zendesk','freshdesk','serpapi','openweather','elevenlabs','stability_ai','hugging_face','pinecone',
       'microsoft_teams','salesforce','pipedrive','zoho_crm','freshsales','close','apollo','intercom',
       'jira','asana','trello','clickup','monday','todoist','airtable','bitbucket','netlify',
       'woocommerce','paypal','paddle','lemon_squeezy','square','razorpay','zoom','cal_com','twilio_voice','docusign',
       'x_twitter','linkedin','facebook_pages','instagram','tiktok','mailchimp','typeform',
       'supabase','postgresql','mysql','mongodb','redis','firebase','dropbox','aws_s3','cloudflare_r2'
     )
     or p_display_name is null
     or length(trim(p_display_name)) not between 1 and 120
     or p_encrypted_credentials is null
     or length(p_encrypted_credentials) not between 32 and 65536
     or p_created_by is null then
    raise exception using errcode = '22023', message = 'Invalid workspace integration connection request';
  end if;

  if not exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = p_created_by
  ) and not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_created_by
      and wm.role in ('owner','admin')
  ) then
    raise exception using errcode = '42501', message = 'Workspace administrator permission required';
  end if;

  if p_connection_id is null then
    insert into public.workspace_integrations (
      workspace_id, provider, status, display_name, metadata, created_by,
      last_tested_at, last_test_status, updated_at
    ) values (
      p_workspace_id, p_provider, 'needs_attention', trim(p_display_name), '{}'::jsonb, p_created_by,
      null, null, v_now
    ) returning id into v_connection_id;
  else
    update public.workspace_integrations
       set display_name = trim(p_display_name),
           status = 'needs_attention',
           last_tested_at = null,
           last_test_status = null,
           updated_at = v_now
     where id = p_connection_id
       and workspace_id = p_workspace_id
       and provider = p_provider
     returning id into v_connection_id;

    if v_connection_id is null then
      raise exception using errcode = 'P0002', message = 'Workspace integration connection not found';
    end if;
  end if;

  insert into public.workspace_integration_secrets (
    integration_id, encrypted_credentials, encryption_version, updated_at
  ) values (
    v_connection_id, p_encrypted_credentials, 'v1', v_now
  )
  on conflict (integration_id) do update
    set encrypted_credentials = excluded.encrypted_credentials,
        encryption_version = excluded.encryption_version,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'id', v_connection_id,
    'provider', p_provider,
    'display_name', trim(p_display_name),
    'status', 'needs_attention',
    'last_tested_at', null,
    'last_test_status', null,
    'updated_at', v_now
  );
end;
$$;

revoke all on function public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid)
  to service_role;
