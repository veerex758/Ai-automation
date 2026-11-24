-- Shared API ingress throttling and versioned workspace credential keyring.
-- Additive and service-role-only. Apply only after Preview migration history is reconciled.

create table if not exists public.api_rate_limit_buckets (
  scope text not null check (scope ~ '^[a-z][a-z0-9:_-]{1,79}$'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{32}$'),
  window_started_at timestamptz not null,
  hit_count integer not null check (hit_count between 1 and 10000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (scope, key_hash)
);
create index if not exists api_rate_limit_buckets_expiry_idx on public.api_rate_limit_buckets(updated_at);
alter table public.api_rate_limit_buckets enable row level security;
revoke all on public.api_rate_limit_buckets from public, anon, authenticated;
grant all on public.api_rate_limit_buckets to service_role;

create or replace function public.consume_api_rate_limit(
  p_scope text, p_key text, p_limit integer, p_window_ms integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  now_at timestamptz := clock_timestamp();
  key_digest text;
  bucket public.api_rate_limit_buckets%rowtype;
  allowed boolean;
  remaining integer;
  retry_ms integer;
begin
  if p_scope is null or p_scope !~ '^[a-z][a-z0-9:_-]{1,79}$'
     or p_key is null or length(p_key) not between 1 and 512
     or p_limit is null or p_limit not between 1 and 10000
     or p_window_ms is null or p_window_ms not between 100 and 86400000 then
    raise exception using errcode='22023', message='Invalid API rate limit request';
  end if;
  key_digest := md5(p_key);
  delete from public.api_rate_limit_buckets
  where ctid in (
    select ctid from public.api_rate_limit_buckets
    where updated_at < now_at - interval '24 hours'
    order by updated_at limit 500
  );
  insert into public.api_rate_limit_buckets as current_bucket
    (scope, key_hash, window_started_at, hit_count, updated_at)
  values (p_scope, key_digest, now_at, 1, now_at)
  on conflict (scope, key_hash) do update
    set window_started_at = case
          when current_bucket.window_started_at + (p_window_ms * interval '1 millisecond') <= now_at
          then now_at else current_bucket.window_started_at end,
        hit_count = case
          when current_bucket.window_started_at + (p_window_ms * interval '1 millisecond') <= now_at then 1
          when current_bucket.hit_count < p_limit then current_bucket.hit_count + 1
          else current_bucket.hit_count end,
        updated_at = now_at
  returning * into bucket;
  allowed := bucket.hit_count <= p_limit;
  remaining := greatest(0, p_limit - bucket.hit_count);
  if allowed then retry_ms := 0;
  else retry_ms := greatest(1, ceil(extract(epoch from (
    bucket.window_started_at + (p_window_ms * interval '1 millisecond') - now_at
  )) * 1000)::integer);
  end if;
  return jsonb_build_object('allowed',allowed,'remaining',remaining,'retryAfterMs',retry_ms);
end;
$$;
revoke all on function public.consume_api_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text,text,integer,integer) to service_role;

alter table public.workspace_integration_secrets drop constraint if exists workspace_integration_secrets_encryption_version_check;
alter table public.workspace_integration_secrets add constraint workspace_integration_secrets_encryption_version_check
  check (encryption_version in ('v1', 'v2', 'v3'));

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
  or not (
    p_encrypted_credentials ~ '^v[12]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    or p_encrypted_credentials ~ '^v3\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  ) then
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

