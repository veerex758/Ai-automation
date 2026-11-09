-- Phase C discovery: editorial collections and curated product ordering.
create table if not exists public.marketplace_collections (
 id uuid primary key default gen_random_uuid(), slug varchar(120) not null unique check(slug ~ '^[a-z0-9-]+$'),
 name varchar(140) not null, description varchar(1000) not null default '', status text not null default 'draft' check(status in ('draft','published','archived')),
 cover_image_url text, published_at timestamptz, created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.marketplace_collection_products (
 collection_id uuid not null references public.marketplace_collections(id) on delete cascade,
 product_id uuid not null references public.marketplace_products(id) on delete cascade,
 sort_order integer not null default 0 check(sort_order>=0), editorial_note varchar(500) not null default '',
 created_at timestamptz not null default now(), primary key(collection_id,product_id)
);
create index if not exists marketplace_collection_products_order_idx on public.marketplace_collection_products(collection_id,sort_order);
alter table public.marketplace_collections enable row level security;alter table public.marketplace_collection_products enable row level security;
revoke all on public.marketplace_collections,public.marketplace_collection_products from anon,authenticated;
grant select on public.marketplace_collections,public.marketplace_collection_products to anon,authenticated;
create policy marketplace_public_collections_read on public.marketplace_collections for select to anon,authenticated using(status='published' and published_at is not null and published_at<=now());
create policy marketplace_public_collection_items_read on public.marketplace_collection_products for select to anon,authenticated using(exists(select 1 from public.marketplace_collections c where c.id=collection_id and c.status='published' and c.published_at is not null and c.published_at<=now()));
