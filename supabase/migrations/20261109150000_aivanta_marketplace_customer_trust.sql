-- Marketplace Phase A trust: customer ratings, abuse reports and notices.
create table if not exists public.marketplace_product_reviews (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.marketplace_products(id) on delete cascade,
 reviewer_id uuid not null references auth.users(id) on delete cascade, rating smallint not null check (rating between 1 and 5),
 title varchar(120) not null default '', body varchar(2000) not null default '',
 status text not null default 'published' check (status in ('published','hidden','removed')),
 moderation_reason varchar(500), moderated_by uuid references auth.users(id) on delete set null, moderated_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(product_id,reviewer_id)
);
create index if not exists marketplace_product_reviews_public_idx on public.marketplace_product_reviews(product_id,status,created_at desc);
create table if not exists public.marketplace_product_reports (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.marketplace_products(id) on delete cascade,
 reporter_id uuid not null references auth.users(id) on delete cascade,
 category text not null check (category in ('abuse','ip','security','privacy','misrepresentation','other')),
 details varchar(4000) not null, status text not null default 'open' check (status in ('open','triaged','investigating','resolved','dismissed')),
 assigned_to uuid references auth.users(id) on delete set null, resolution varchar(2000),
 resolved_at timestamptz, resolved_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists marketplace_product_reports_queue_idx on public.marketplace_product_reports(status,created_at);
create unique index if not exists marketplace_product_reports_open_reporter_product on public.marketplace_product_reports(product_id,reporter_id,category) where status in ('open','triaged','investigating');
create table if not exists public.marketplace_customer_notices (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 product_id uuid references public.marketplace_products(id) on delete set null, installation_id uuid references public.marketplace_installations(id) on delete set null,
 notice_type text not null check (notice_type in ('permission_change','integration_change','usage_limit','verification_revoked','product_suspended','security_incident','update_available','product_removed')),
 title varchar(180) not null, body varchar(3000) not null, action_url text, read_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists marketplace_customer_notices_inbox_idx on public.marketplace_customer_notices(user_id,created_at desc);
alter table public.marketplace_product_reviews enable row level security; alter table public.marketplace_product_reports enable row level security; alter table public.marketplace_customer_notices enable row level security;
revoke all on public.marketplace_product_reviews,public.marketplace_product_reports,public.marketplace_customer_notices from anon,authenticated;
grant select on public.marketplace_product_reviews to anon,authenticated; grant insert,update on public.marketplace_product_reviews to authenticated;
grant insert,select on public.marketplace_product_reports to authenticated; grant select,update on public.marketplace_customer_notices to authenticated;
create policy marketplace_reviews_public_read on public.marketplace_product_reviews for select to anon,authenticated using (status='published');
create policy marketplace_reviews_own_insert on public.marketplace_product_reviews for insert to authenticated with check (
 reviewer_id=auth.uid() and status='published' and moderated_by is null and moderated_at is null
 and (exists(select 1 from public.marketplace_purchases p where p.product_id=marketplace_product_reviews.product_id and p.buyer_user_id=auth.uid() and p.status in ('paid','refunded'))
 or exists(select 1 from public.marketplace_installations i where i.product_id=marketplace_product_reviews.product_id and i.installed_by=auth.uid() and i.status in ('configuring','ready','active','paused','removed')))
);
create policy marketplace_reviews_own_update on public.marketplace_product_reviews for update to authenticated using (reviewer_id=auth.uid() and status='published' and moderated_at is null) with check (reviewer_id=auth.uid() and moderated_by is null and moderated_at is null);
create policy marketplace_reports_own_insert on public.marketplace_product_reports for insert to authenticated with check (reporter_id=auth.uid() and status='open' and assigned_to is null and resolved_by is null and resolved_at is null and exists(select 1 from public.marketplace_products p where p.id=product_id and p.status in ('published','suspended')));
create policy marketplace_reports_own_read on public.marketplace_product_reports for select to authenticated using (reporter_id=auth.uid());
create policy marketplace_notices_own_read on public.marketplace_customer_notices for select to authenticated using (user_id=auth.uid());
create policy marketplace_notices_own_update on public.marketplace_customer_notices for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
-- Moderation and notice delivery writes are service-role only.

-- Apply customer column restrictions only after the trust tables are created.
revoke update on public.marketplace_product_reviews from authenticated;
grant update(rating,title,body,updated_at) on public.marketplace_product_reviews to authenticated;
revoke update on public.marketplace_customer_notices from authenticated;
grant update(read_at) on public.marketplace_customer_notices to authenticated;
