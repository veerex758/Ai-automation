begin;
create table if not exists public.marketplace_bundle_refund_requests(
 id uuid primary key default gen_random_uuid(),bundle_purchase_id uuid not null unique references public.marketplace_bundle_purchases(id) on delete restrict,
 buyer_user_id uuid not null references auth.users(id) on delete restrict,reason text not null check(length(trim(reason)) between 10 and 1000),
 status text not null default 'requested' check(status in ('requested','under_review','approved','rejected','completed')),
 reviewer_user_id uuid references auth.users(id) on delete restrict,review_note text,requested_at timestamptz not null default now(),reviewed_at timestamptz,completed_at timestamptz
);
alter table public.marketplace_bundle_refund_requests enable row level security;
revoke all on public.marketplace_bundle_refund_requests from anon,authenticated;grant select,insert on public.marketplace_bundle_refund_requests to authenticated;grant all on public.marketplace_bundle_refund_requests to service_role;
create policy marketplace_bundle_refund_buyer_read on public.marketplace_bundle_refund_requests for select to authenticated using(buyer_user_id=auth.uid());
create policy marketplace_bundle_refund_buyer_create on public.marketplace_bundle_refund_requests for insert to authenticated with check(buyer_user_id=auth.uid() and status='requested' and reviewer_user_id is null and reviewed_at is null and completed_at is null);
create or replace function public.marketplace_review_bundle_refund_request(p_request_id uuid,p_reviewer_id uuid,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.marketplace_bundle_refund_requests%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'bundle_refund_review_service_role_required';end if;
 if p_status not in ('under_review','approved','rejected') or length(trim(p_note)) not between 5 and 1000 then raise exception 'invalid_bundle_refund_review';end if;
 select * into r from public.marketplace_bundle_refund_requests where id=p_request_id for update;if not found then raise exception 'bundle_refund_request_not_found';end if;if r.status not in ('requested','under_review') then raise exception 'bundle_refund_request_resolved';end if;
 update public.marketplace_bundle_refund_requests set status=p_status,reviewer_user_id=p_reviewer_id,review_note=trim(p_note),reviewed_at=now() where id=r.id;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details) values(p_reviewer_id,'bundle_refund_request_'||p_status,'bundle_refund_request',r.id,jsonb_build_object('bundle_purchase_id',r.bundle_purchase_id,'note',trim(p_note)));
 return jsonb_build_object('id',r.id,'status',p_status,'reviewed_at',now());
end $$;
revoke all on function public.marketplace_review_bundle_refund_request(uuid,uuid,text,text) from public,anon,authenticated;grant execute on function public.marketplace_review_bundle_refund_request(uuid,uuid,text,text) to service_role;
commit;
