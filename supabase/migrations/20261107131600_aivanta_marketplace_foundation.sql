-- Marketplace Phase 1 foundation: catalog, immutable versions, verification gates, purchases, entitlements, and workspace installations. Staging replay required before apply.
create table if not exists public.marketplace_creators (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete cascade,
 display_name varchar(100) not null check (char_length(trim(display_name)) between 1 and 100),
 slug varchar(120) not null unique check (slug ~ '^[a-z0-9-]+$'), bio varchar(1000) not null default '',
 status text not null default 'pending' check (status in ('pending','verified','suspended')),
 payout_provider text, payout_account_ref text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.marketplace_categories (
 id uuid primary key default gen_random_uuid(), slug varchar(80) not null unique check (slug ~ '^[a-z0-9-]+$'),
 name varchar(100) not null, description varchar(500) not null default '', sort_order integer not null default 0,
 is_active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.marketplace_products (
 id uuid primary key default gen_random_uuid(), creator_id uuid references public.marketplace_creators(id) on delete restrict,
 category_id uuid not null references public.marketplace_categories(id) on delete restrict,
 slug varchar(160) not null unique check (slug ~ '^[a-z0-9-]+$'), name varchar(140) not null check (char_length(trim(name)) between 1 and 140),
 summary varchar(280) not null, description text not null default '',
 product_type text not null check (product_type in ('workflow','pack','agent')),
 pricing_type text not null default 'free' check (pricing_type in ('free','one_time','recurring')),
 price_minor integer not null default 0 check (price_minor >= 0), currency char(3) not null default 'USD' check (currency='USD'),
 recurring_interval text check (recurring_interval in ('month','year')),
 required_plan text not null default 'free' check (required_plan in ('free','starter','pro','business','enterprise')),
 integrations jsonb not null default '[]'::jsonb check (jsonb_typeof(integrations)='array'),
 permissions jsonb not null default '[]'::jsonb check (jsonb_typeof(permissions)='array'),
 expected_usage jsonb not null default '{}'::jsonb check (jsonb_typeof(expected_usage)='object'),
 status text not null default 'draft' check (status in ('draft','submitted','changes_requested','rejected','verified','published','suspended','revoked','archived')),
 current_version_id uuid, published_at timestamptz, created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((pricing_type='free' and price_minor=0) or (pricing_type<>'free' and price_minor>0)),
 check ((pricing_type='recurring' and recurring_interval is not null) or pricing_type<>'recurring')
);
create table if not exists public.marketplace_product_versions (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.marketplace_products(id) on delete cascade,
 version varchar(40) not null, artifact_path text not null,
 artifact_sha256 char(64) not null check (artifact_sha256 ~ '^[a-f0-9]{64}$'),
 manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest)='object'), changelog text not null default '',
 verification_status text not null default 'pending' check (verification_status in ('pending','approved','rejected','revoked')),
 verified_at timestamptz, verified_by uuid references auth.users(id) on delete set null,
 created_by uuid not null default auth.uid() references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
 unique(product_id,version), unique(product_id,id)
);
alter table public.marketplace_products add constraint marketplace_products_current_version_fk foreign key (id,current_version_id) references public.marketplace_product_versions(product_id,id) deferrable initially deferred;
create table if not exists public.marketplace_verification_reviews (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.marketplace_products(id) on delete cascade,
 version_id uuid not null references public.marketplace_product_versions(id) on delete cascade,
 review_type text not null check (review_type in ('automated','human','security','reverification')),
 status text not null check (status in ('queued','running','passed','failed','changes_requested','approved','rejected')),
 checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks)='array'),
 reviewer_id uuid references auth.users(id) on delete set null, notes text not null default '',
 created_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists public.marketplace_purchases (
 id uuid primary key default gen_random_uuid(), buyer_user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
 product_id uuid not null references public.marketplace_products(id) on delete restrict,
 product_version_id uuid not null references public.marketplace_product_versions(id) on delete restrict,
 provider text not null, provider_checkout_id text unique, provider_payment_id text unique,
 amount_minor integer not null check (amount_minor >= 0), currency char(3) not null default 'USD' check (currency='USD'),
 status text not null default 'pending' check (status in ('pending','paid','refunded','disputed','failed')),
 created_at timestamptz not null default now(), paid_at timestamptz, refunded_at timestamptz
);
create table if not exists public.marketplace_entitlements (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 product_id uuid not null references public.marketplace_products(id) on delete restrict,
 purchase_id uuid references public.marketplace_purchases(id) on delete restrict,
 entitlement_type text not null check (entitlement_type in ('free','purchase','subscription','admin_grant')),
 status text not null default 'active' check (status in ('active','revoked','expired')),
 starts_at timestamptz not null default now(), ends_at timestamptz, created_at timestamptz not null default now(),
 unique(user_id,product_id,purchase_id)
);
create table if not exists public.marketplace_installations (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 product_id uuid not null references public.marketplace_products(id) on delete restrict,
 product_version_id uuid not null references public.marketplace_product_versions(id) on delete restrict,
 installed_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
 workflow_id uuid references public.workflows(id) on delete set null,
 status text not null default 'configuring' check (status in ('configuring','ready','active','paused','removed')),
 configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration)='object'),
 installed_at timestamptz not null default now(), activated_at timestamptz, removed_at timestamptz
);
create index if not exists marketplace_products_public_idx on public.marketplace_products(status,category_id,updated_at desc);
create index if not exists marketplace_versions_product_idx on public.marketplace_product_versions(product_id,created_at desc);
create index if not exists marketplace_reviews_product_idx on public.marketplace_verification_reviews(product_id,created_at desc);
create index if not exists marketplace_purchases_buyer_idx on public.marketplace_purchases(buyer_user_id,created_at desc);
create index if not exists marketplace_entitlements_user_idx on public.marketplace_entitlements(user_id,status);
create index if not exists marketplace_installations_workspace_idx on public.marketplace_installations(workspace_id,installed_at desc);
alter table public.marketplace_creators enable row level security;
alter table public.marketplace_categories enable row level security;
alter table public.marketplace_products enable row level security;
alter table public.marketplace_product_versions enable row level security;
alter table public.marketplace_verification_reviews enable row level security;
alter table public.marketplace_purchases enable row level security;
alter table public.marketplace_entitlements enable row level security;
alter table public.marketplace_installations enable row level security;
create policy marketplace_categories_public_read on public.marketplace_categories for select to anon,authenticated using (is_active);
create policy marketplace_products_public_read on public.marketplace_products for select to anon,authenticated using (status='published' and current_version_id is not null and exists (select 1 from public.marketplace_product_versions v where v.id=current_version_id and v.product_id=id and v.verification_status='approved'));
create policy marketplace_products_creator_read on public.marketplace_products for select to authenticated using (created_by=auth.uid());
create policy marketplace_products_creator_insert on public.marketplace_products for insert to authenticated with check (created_by=auth.uid() and status='draft');
create policy marketplace_products_creator_update on public.marketplace_products for update to authenticated using (created_by=auth.uid() and status in ('draft','changes_requested')) with check (created_by=auth.uid() and status in ('draft','changes_requested'));
create policy marketplace_creators_public_read on public.marketplace_creators for select to anon,authenticated using (status='verified');
create policy marketplace_creators_owner_read on public.marketplace_creators for select to authenticated using (user_id=auth.uid());
create policy marketplace_creators_owner_insert on public.marketplace_creators for insert to authenticated with check (user_id=auth.uid() and status='pending');
create policy marketplace_creators_owner_update on public.marketplace_creators for update to authenticated using (user_id=auth.uid() and status='pending') with check (user_id=auth.uid() and status='pending');
create policy marketplace_versions_public_read on public.marketplace_product_versions for select to anon,authenticated using (verification_status='approved' and exists(select 1 from public.marketplace_products p where p.id=product_id and p.status='published' and p.current_version_id=id));
create policy marketplace_versions_creator_read on public.marketplace_product_versions for select to authenticated using (exists(select 1 from public.marketplace_products p where p.id=product_id and p.created_by=auth.uid()));
create policy marketplace_versions_creator_insert on public.marketplace_product_versions for insert to authenticated with check (created_by=auth.uid() and exists(select 1 from public.marketplace_products p where p.id=product_id and p.created_by=auth.uid() and p.status in ('draft','changes_requested')));
create policy marketplace_reviews_creator_read on public.marketplace_verification_reviews for select to authenticated using (exists(select 1 from public.marketplace_products p where p.id=product_id and p.created_by=auth.uid()));
create policy marketplace_purchases_buyer_read on public.marketplace_purchases for select to authenticated using (buyer_user_id=auth.uid());
create policy marketplace_entitlements_owner_read on public.marketplace_entitlements for select to authenticated using (user_id=auth.uid());
create policy marketplace_installations_workspace_read on public.marketplace_installations for select to authenticated using (private.is_workspace_member(workspace_id));
create policy marketplace_installations_workspace_insert on public.marketplace_installations for insert to authenticated with check (private.is_workspace_member(workspace_id) and installed_by=auth.uid());
create policy marketplace_installations_workspace_update on public.marketplace_installations for update to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
grant select on public.marketplace_categories,public.marketplace_products,public.marketplace_product_versions,public.marketplace_creators to anon,authenticated;
grant select,insert,update on public.marketplace_creators to authenticated;
grant select,insert,update on public.marketplace_products to authenticated;
grant select,insert on public.marketplace_product_versions to authenticated;
grant select on public.marketplace_verification_reviews,public.marketplace_purchases,public.marketplace_entitlements to authenticated;
grant select,insert,update on public.marketplace_installations to authenticated;
revoke all on public.marketplace_verification_reviews from anon,authenticated;
grant select on public.marketplace_verification_reviews to authenticated;
revoke all on public.marketplace_purchases,public.marketplace_entitlements from anon,authenticated;
grant select on public.marketplace_purchases,public.marketplace_entitlements to authenticated;
-- Approval, publication, purchases, entitlement grants, and financial writes are service-role only.
