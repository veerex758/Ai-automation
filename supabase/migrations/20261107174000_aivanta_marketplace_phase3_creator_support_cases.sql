-- Creator support and appeals are durable, caller-scoped and deliberately separate from finance decisions.
create table if not exists public.marketplace_creator_support_cases(
 id uuid primary key default gen_random_uuid(),
 creator_id uuid not null references public.marketplace_creators(id) on delete restrict,
 category text not null check(category in ('payout','tax','verification','ledger','account','other')),
 subject text not null check(length(trim(subject)) between 8 and 160),
 description text not null check(length(trim(description)) between 20 and 5000),
 related_payout_request_id uuid references public.marketplace_payout_requests(id) on delete restrict,
 status text not null default 'submitted' check(status in ('submitted','under_review','resolved','closed')),
 idempotency_key text not null check(length(trim(idempotency_key)) between 8 and 128),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(creator_id,idempotency_key)
);
create index if not exists marketplace_creator_support_creator_idx on public.marketplace_creator_support_cases(creator_id,created_at desc);
alter table public.marketplace_creator_support_cases enable row level security;
revoke all on public.marketplace_creator_support_cases from anon,authenticated;
grant select,insert,update on public.marketplace_creator_support_cases to service_role;

create or replace function public.marketplace_my_creator_support_cases()
returns table(id uuid,category text,subject text,description text,related_payout_request_id uuid,status text,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select s.id,s.category,s.subject,s.description,s.related_payout_request_id,s.status,s.created_at,s.updated_at
 from public.marketplace_creator_support_cases s join public.marketplace_creators c on c.id=s.creator_id
 where c.user_id=auth.uid() order by s.created_at desc limit 100;
$$;
revoke all on function public.marketplace_my_creator_support_cases() from public,anon;
grant execute on function public.marketplace_my_creator_support_cases() to authenticated;

create or replace function public.marketplace_create_creator_support_case(
 p_category text,p_subject text,p_description text,p_related_payout_request_id uuid,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare creator public.marketplace_creators%rowtype; case_id uuid; prior public.marketplace_creator_support_cases%rowtype;
begin
 if auth.uid() is null or p_category not in ('payout','tax','verification','ledger','account','other')
 or length(trim(coalesce(p_subject,''))) not between 8 and 160
 or length(trim(coalesce(p_description,''))) not between 20 and 5000
 or length(trim(coalesce(p_idempotency_key,''))) not between 8 and 128 then
  raise exception 'invalid_creator_support_case';
 end if;
 select * into creator from public.marketplace_creators where user_id=auth.uid() and status='verified' for update;
 if not found then raise exception 'creator_not_eligible'; end if;
 if p_related_payout_request_id is not null and not exists(select 1 from public.marketplace_payout_requests where id=p_related_payout_request_id and creator_id=creator.id) then
  raise exception 'support_payout_not_found';
 end if;
 select * into prior from public.marketplace_creator_support_cases where creator_id=creator.id and idempotency_key=p_idempotency_key;
 if found then
  if prior.category<>p_category or prior.subject<>trim(p_subject) or prior.description<>trim(p_description) or prior.related_payout_request_id is distinct from p_related_payout_request_id then
   raise exception 'support_idempotency_conflict';
  end if;
  return prior.id;
 end if;
 insert into public.marketplace_creator_support_cases(creator_id,category,subject,description,related_payout_request_id,idempotency_key)
 values(creator.id,p_category,trim(p_subject),trim(p_description),p_related_payout_request_id,trim(p_idempotency_key)) returning id into case_id;
 return case_id;
end; $$;
revoke all on function public.marketplace_create_creator_support_case(text,text,text,uuid,text) from public,anon;
grant execute on function public.marketplace_create_creator_support_case(text,text,text,uuid,text) to authenticated;
