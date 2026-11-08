begin;
create table if not exists public.marketplace_refund_requests(
 id uuid primary key default gen_random_uuid(),purchase_id uuid not null references public.marketplace_purchases(id) on delete restrict,
 buyer_user_id uuid not null references auth.users(id) on delete restrict,reason text not null check(length(trim(reason)) between 10 and 1000),
 status text not null default 'requested' check(status in ('requested','under_review','approved','rejected','completed','cancelled')),
 reviewer_user_id uuid references auth.users(id) on delete restrict,review_note text,requested_at timestamptz not null default now(),reviewed_at timestamptz,completed_at timestamptz,
 unique(purchase_id)
);
alter table public.marketplace_refund_requests enable row level security;
revoke all on public.marketplace_refund_requests from anon,authenticated;
grant select,insert on public.marketplace_refund_requests to authenticated;
grant all on public.marketplace_refund_requests to service_role;
create policy marketplace_refund_request_buyer_read on public.marketplace_refund_requests for select to authenticated using(buyer_user_id=auth.uid());
create policy marketplace_refund_request_buyer_create on public.marketplace_refund_requests for insert to authenticated with check(buyer_user_id=auth.uid() and status='requested' and reviewer_user_id is null and reviewed_at is null and completed_at is null);
commit;
