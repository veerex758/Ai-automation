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

-- Keep this narrow RPC separate from the general provider saver so a new
-- database connection cannot accidentally expand the API-key provider list.
create or replace function public.save_workspace_database_credentials(
  p_workspace_id uuid,
  p_provider text,
  p_display_name text,
  p_encrypted_credential¶»§q«^