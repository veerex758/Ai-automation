-- Phase C developer API credential lifecycle (additive, service-role managed).
begin;
create table if not exists public.marketplace_api_keys (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references auth.users(id) on delete restrict,
 label text not null check(length(trim(label)) between 1 and 80),
 key_prefix text not null unique check(key_prefix ~ '^avt_[a-f0-9]{8}$'),
 key_hash text not null unique check(key_hash ~ '^[a-f0-9]{64}$'),
 scopes text[] not null default array['marketplace:read']::text[],
 created_at timestamptz not null default now(),
 expires_at timestamptz,
 revoked_at timestamptz,
 last_used_at timestamptz,
 check(cardinality(scopes)>0 and scopes <@ array['marketplace:read','marketplace:publish']::text[]),
 check(expires_at is null or expires_at>created_at)
);
create index if not exists marketplace_api_keys_owner_idx on public.marketplace_api_keys(owner_user_id,created_at desc);
alter table public.marketplace_api_keys enable row level security;
revoke all on public.marketplace_api_keys from anon,authenticated;
grant all on public.marketplace_api_keys to service_role;
comment on table public.marketplace_api_keys is 'Developer API credentials; raw secrets are never persisted or returned after creation.';
commit;
