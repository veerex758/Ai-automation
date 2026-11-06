-- Rollback for 20261106213337_mysql_mongodb_workspace_credentials.sql.
-- Refuse to narrow the provider constraint while customer credentials exist.
do $$
begin
  if exists (
    select 1 from public.workspace_integrations
    where provider in ('mysql','mongodb')
  ) then
    raise exception 'Remove or migrate MySQL/MongoDB workspace integrations before rollback';
  end if;
end
$$;

drop function if exists public.save_workspace_database_credentials(uuid,text,text,text,uuid);

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
    'supa¶»§q«^