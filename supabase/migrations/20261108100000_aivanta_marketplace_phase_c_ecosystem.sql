-- Marketplace Phase C: ecosystem, private distribution, enterprise licensing and promotion integrity.
-- Additive/reversible: no hosted database changes and no provider-side actions.
begin;
create table if not exists public.marketplace_bundles (
 id uuid primary key default gen_random_uuid(), creator_id uuid not null references public.marketplace_creators(id) on delete restrict,
 slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 title text not null check(length(trim(title)) between 3 and 120), description text not null default '' check(length(description)<=12000),
 status text not null default 'draft' check(status in ('draft','submitted','published','suspended','archived')),
 pricing_type text not null default 'free' check(pricing_type in ('free','one_time','subscription')),
 price_minor bigint not null default 0 check(price_minor>=0), currency char(3) not null default 'USD' check(currency='USD'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), published_at timestamptz,
 check((pricing_type='free' and price_minor=0) or (pricing_type<>'free' and price_minor>0))
);
create index if not exists marketplace_bundles_public_idx on public.marketplace_bundles(status,published_at desc);
create table if not exists public.marketplace_bundle_items (
 bundle_id uuid not null references public.marketplace_bundles(id) on delete cascade,
 product_id uuid not null references public.marketplace_products(id) on delete restrict,
 product_version_id uuid not null references public.marketplace_product_versions(id) on delete restrict,
 position smallint not null check(position between 0 and 99), primary key(bundle_id,product_id), unique(bundle_id,position)
);
create table if not exists public.marketplace_private_spaces (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id) on delete restrict,
 workspace_id uuid not null, name text not null check(length(trim(name)) between 2 and 120),
 slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 status text not null default 'active' check(status in ('active','suspended','archived')), created_at timestamptz not null default now(), unique(workspace_id,slug)
);
create table if not exists public.marketplace_private_space_members (
 space_id uuid not null references public.marketplace_private_spaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'member' check(role in ('member','manager','buyer')),
 granted_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(), primary key(space_id,user_id)
);
create table if not exists public.marketplace_private_listings (
 space_id uuid not null references public.marketplace_private_spaces(id) on delete cascade,
 product_id uuid not null references public.marketplace_products(id) on delete restrict,
 product_version_id uuid not null references public.marketplace_product_versions(id) on delete restrict,
 listed_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
 primary key(space_id,product_id,product_version_id)
);
create table if not exists public.marketplace_licenses (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.marketplace_products(id) on delete restrict,
 product_version_id uuid not null references public.marketplace_product_versions(id) on delete restrict,
 buyer_workspace_id uuid not null, license_type text not null check(license_type in ('seat','site','enterprise')),
 seats integer check(seats is null or seats between 1 and 100000),
 status text not null default 'pending' check(status in ('pending','active','suspended','expired','revoked')),
 starts_at timestamptz, expires_at timestamptz, created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
 check(expires_at is null or starts_at is null or expires_at>starts_at)
);
create index if not exists marketplace_licenses_workspace_idx on public.marketplace_licenses(buyer_workspace_id,status,expires_at);
create table if not exists public.marketplace_promotions (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.marketplace_products(id) on delete restrict,
 creator_id uuid not null references public.marketplace_creators(id) on delete restrict,
 status text not null default 'pending' check(status in ('pending','approved','active','paused','ended','rejected')),
 disclosure_label text not null default 'Sponsored' check(disclosure_label='Sponsored'),
 starts_at timestamptz not null, ends_at timestamptz not null, budget_minor bigint not null check(budget_minor>0),
 currency char(3) not null default 'USD' check(currency='USD'), approved_by uuid references auth.users(id) on delete restrict, approved_at timestamptz,
 created_at timestamptz not null default now(), check(ends_at>starts_at),
 check((status in ('approved','active','paused','ended') and approved_by is not null and approved_at is not null) or status in ('pending','rejected'))
);
create index if not exists marketplace_promotions_active_idx on public.marketplace_promotions(status,starts_at,ends_at);
create table if not exists public.marketplace_discovery_events (
 id uuid primary key default gen_random_uuid(), actor_hash text not null check(actor_hash ~ '^[a-f0-9]{64}$'),
 event_type text not null check(event_type in ('search','view','collection_open','install_click')),
 product_id uuid references public.marketplace_products(id) on delete set null, category_slug text,
 query_hash text check(query_hash is null or query_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now()
);
create index if not exists marketplace_discovery_events_created_idx on public.marketplace_discovery_events(created_at desc);
create index if not exists marketplace_discovery_events_product_idx on public.marketplace_discovery_events(product_id,created_at desc);
alter table public.marketplace_bundles enable row level security;
alter table public.marketplace_bundle_items enable row level security;
alter table public.marketplace_private_spaces enable row level security;
alter table public.marketplace_private_space_members enable row level security;
alter table public.marketplace_private_listings enable row level security;
alter table public.marketplace_licenses enable row level security;
alter table public.marketplace_promotions enable row level security;
alter table public.marketplace_discovery_events enable row level security;
revoke all on public.marketplace_bundles,public.marketplace_bundle_items,public.marketplace_private_spaces,public.marketplace_private_space_members,public.marketplace_private_listings,public.marketplace_licenses,public.marketplace_promotions,public.marketplace_discovery_events from anon,authenticated;
grant select on public.marketplace_bundles,public.marketplace_bundle_items to anon,authenticated;
grant all on public.marketplace_bundles,public.marketplace_bundle_items,public.marketplace_private_spaces,public.marketplace_private_space_members,public.marketplace_private_listings,public.marketplace_licenses,public.marketplace_promotions,public.marketplace_discovery_events to service_role;
create policy marketplace_bundles_public_verified on public.marketplace_bundles for select to anon,authenticated using (
 status='published' and exists(select 1 from public.marketplace_bundle_items bi where bi.bundle_id=marketplace_bundles.id)
 and not exists(select 1 from public.marketplace_bundle_items bi join public.marketplace_products p on p.id=bi.product_id join public.marketplace_product_versions v on v.id=bi.product_version_id and v.product_id=p.id where bi.bundle_id=marketplace_bundles.id and (p.status<>'published' or p.current_version_id<>v.id or v.verification_status<>'approved'))
);
create policy marketplace_bundle_items_public_verified on public.marketplace_bundle_items for select to authenticated using (
 exists(select 1 from public.marketplace_bundles b where b.id=bundle_id and b.status='published')
 and exists(select 1 from public.marketplace_products p join public.marketplace_product_versions v on v.id=product_version_id and v.product_id=p.id where p.id=product_id and p.status='published' and p.current_version_id=v.id and v.verification_status='approved')
);
commit;
