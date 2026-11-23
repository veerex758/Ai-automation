-- Multi-account workspace integrations with connection-bound credential encryption.
-- Existing v1 envelopes and legacy RPC signatures remain compatible.
alter table public.workspace_integrations drop constraint if exists workspace_integrations_workspace_id_provider_key;
alter table public.workspace_integrations drop constraint if exists workspace_integrations_provider_check;
alter table public.workspace_integrations add constraint workspace_integrations_provider_check
 check (provider in ('openai','gemini','resend','slack','http','notion','hubspot','twilio','shopify','stripe','linear',
'claude','mistral','groq','perplexity','discord','telegram','whatsapp_business','sendgrid','mailgun','postmark',
'github','gitlab','sentry','vercel','calendly','zendesk','freshdesk','serpapi','openweather','elevenlabs',
'stability_ai','hugging_face','pinecone','microsoft_teams','salesforce','pipedrive','zoho_crm','freshsales',
'close','apollo','intercom','jira','asana','trello','clickup','monday','todoist','airtable','bitbucket',
'netlify','woocommerce','paypal','paddle','lemon_squeezy','square','razorpay','zoom','cal_com','twilio_voice',
'docusign','x_twitter','linkedin','facebook_pages','instagram','tiktok','mailchimp','typeform','supabase',
'postgresql','mysql','mongodb','redis','firebase','dropbox','aws_s3','cloudflare_r2'));
alter table public.workspace_integration_secrets drop constraint if exists workspace_integration_secrets_encryption_version_check;
alter table public.workspace_integration_secrets add constraint workspace_integration_secrets_encryption_version_check check (encryption_version in ('v1','v2'));

create or replace function public.save_workspace_integration_connection(
 p_workspace_id uuid,p_provider text,p_display_name text,p_encrypted_credentials text,
 p_created_by uuid,p_connection_id uuid,p_create_new boolean
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_integration public.workspace_integrations%rowtype; v_encryption_version text;
begin
 if p_workspace_id is null or p_created_by is null or p_connection_id is null or p_create_new is null then
  raise exception using errcode='P0001',message='INTEGRATION_REQUEST_INVALID';
 end if;
 if p_provider is null or p_provider not in ('openai','gemini','resend','slack','http','notion','hubspot','twilio','shopify','stripe','linear',
'claude','mistral','groq','perplexity','discord','telegram','whatsapp_business','sendgrid','mailgun','postmark',
'github','gitlab','sentry','vercel','calendly','zendesk','freshdesk','serpapi','openweather','elevenlabs',
'stability_ai','hugging_face','pinecone','microsoft_teams','salesforce','pipedrive','zoho_crm','freshsales',
'close','apollo','intercom','jira','asana','trello','clickup','monday','todoist','airtable','bitbucket',
'netlify','woocommerce','paypal','paddle','lemon_squeezy','square','razorpay','zoom','cal_com','twilio_voice',
'docusign','x_twitter','linkedin','facebook_pages','instagram','tiktok','mailchimp','typeform','supabase',
'postgresql','mysql','mongodb','redis','firebase','dropbox','aws_s3','cloudflare_r2') then
  raise exception using errcode='P0001',message='INTEGRATION_PROVIDER_UNSUPPORTED';
 end if;
 if p_display_name is null or length(btrim(p_display_name)) not between 1 and 120 then
  raise exception using errcode='P0001',message='INTEGRATION_DISPLAY_NAME_INVALID';
 end if;
 if p_encrypted_credentials is null or length(p_encrypted_credentials) not between 32 and 65536
  or p_encrypted_credentials !~ '^v[12]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
  raise exception using errcode='P0001',message='INTEGRATION_CREDENTIALS_INVALID';
 end if;
 v_encryption_version:=pg_catalog.split_part(p_encrypted_credentials,'.',1);
 if not exists(select 1 from public.workspaces w where w.id=p_workspace_id) then
  raise exception using errcode='P0001',message='INTEGRATION_WORKSPACE_NOT_FOUND';
 end if;
 if not exists(select 1 from public.workspaces w where w.id=p_workspace_id and w.owner_id=p_created_by)
  and not exists(select 1 from public.workspace_members wm where wm.workspace_id=p_workspace_id
   and wm.user_id=p_created_by and wm.role in ('owner','admin')) then
  raise exception using errcode='P0001',message='INTEGRATION_PERMISSION_DENIED';
 end if;
 if p_create_new then
  insert into public.workspace_integrations(id,workspace_id,provider,status,display_name,created_by,updated_at)
  values(p_connection_id,p_workspace_id,p_provider,'needs_attention',btrim(p_display_name),p_created_by,now())
  returning * into v_integration;
 else
  update public.workspace_integrations wi set status='needs_attention',display_name=btrim(p_display_name),
   last_tested_at=null,last_test_status=null,updated_at=now()
  where wi.id=p_connection_id and wi.workspace_id=p_workspace_id and wi.provider=p_provider
  returning wi.* into v_integration;
  if not found then raise exception using errcode='P0001',message='INTEGRATION_CONNECTION_NOT_FOUND'; end if;
 end if;
 insert into public.workspace_integration_secrets(integration_id,encrypted_credentials,encryption_version,updated_at)
 values(v_integration.id,p_encrypted_credentials,v_encryption_version,now())
 on conflict(integration_id) do update set encrypted_credentials=excluded.encrypted_credentials,
  encryption_version=excluded.encryption_version,updated_at=now();
 return jsonb_build_object('id',v_integration.id,'workspace_id',v_integration.workspace_id,
  'provider',v_integration.provider,'status',v_integration.status,'display_name',v_integration.display_name,
  'last_tested_at',v_integration.last_tested_at,'last_test_status',v_integration.last_test_status,
  'created_at',v_integration.created_at,'updated_at',v_integration.updated_at);
end;
$$;

-- Legacy six-argument overload remains compatible:
-- a missing ID creates a fresh connection; a supplied ID updates only that exact
-- workspace/provider connection (the seven-argument function performs the guard).
create or replace function public.save_workspace_integration_connection(
 p_workspace_id uuid,p_provider text,p_display_name text,p_encrypted_credentials text,
 p_created_by uuid,p_connection_id uuid default null
) returns jsonb language plpgsql security invoker set search_path='' as $connection_wrapper$
begin
 return public.save_workspace_integration_connection(
  p_workspace_id,p_provider,p_display_name,p_encrypted_credentials,p_created_by,
  coalesce(p_connection_id,pg_catalog.gen_random_uuid()),p_connection_id is null
 );
end;
$connection_wrapper$;
create or replace function public.save_workspace_integration_credentials(
 p_workspace_id uuid,p_provider text,p_display_name text,p_encrypted_credentials text,p_created_by uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return public.save_workspace_integration_connection(p_workspace_id,p_provider,p_display_name,
  p_encrypted_credentials,p_created_by,null);
end;
$$;
create or replace function public.save_workspace_database_credentials(
 p_workspace_id uuid,p_provider text,p_display_name text,p_encrypted_credential text,p_created_by uuid
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_saved jsonb; v_id uuid;
begin
 if p_provider is null or p_provider not in ('mysql','mongodb') then
  raise exception using errcode='P0001',message='INTEGRATION_PROVIDER_UNSUPPORTED';
 end if;
 v_saved:=public.save_workspace_integration_connection(p_workspace_id,p_provider,p_display_name,
  p_encrypted_credential,p_created_by,null);
 v_id:=(v_saved->>'id')::uuid;
 update public.workspace_integrations set status='needs_attention',last_tested_at=null,last_test_status=null,updated_at=now()
 where id=v_id and workspace_id=p_workspace_id;
 return v_id;
end;
$$;

revoke all on function public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid,boolean) to service_role;
revoke all on function public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_workspace_integration_connection(uuid,text,text,text,uuid,uuid) to service_role;
revoke all on function public.save_workspace_integration_credentials(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_workspace_integration_credentials(uuid,text,text,text,uuid) to service_role;
revoke all on function public.save_workspace_database_credentials(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_workspace_database_credentials(uuid,text,text,text,uuid) to service_role;
alter table public.workspace_integration_secrets enable row level security;
revoke all on table public.workspace_integration_secrets from public,anon,authenticated;
grant all on table public.workspace_integration_secrets to service_role;
