begin;
create table if not exists public.marketplace_promotion_spend(
 id uuid primary key default gen_random_uuid(),promotion_id uuid not null references public.marketplace_promotions(id) on delete restrict,
 event_key text not null unique,amount_minor bigint not null check(amount_minor>0),currency char(3) not null check(currency='USD'),
 spent_at timestamptz not null default now(),metadata jsonb not null default '{}'::jsonb
);
alter table public.marketplace_promotion_spend enable row level security;
revoke all on public.marketplace_promotion_spend from anon,authenticated;
grant all on public.marketplace_promotion_spend to service_role;
create or replace function public.marketplace_review_promotion(p_promotion_id uuid,p_reviewer_id uuid,p_decision text,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_promotions%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'promotion_review_service_role_required';end if;
 if p_decision not in ('approve','reject','pause') or length(trim(coalesce(p_note,'')))>1000 then raise exception 'invalid_promotion_decision';end if;
 select * into p from public.marketplace_promotions where id=p_promotion_id for update;if not found then raise exception 'promotion_not_found';end if;
 if p.status not in ('pending','approved','active','paused') then raise exception 'promotion_transition_invalid';end if;
 if p_decision='approve' then update public.marketplace_promotions set status=case when starts_at<=now() and ends_at>now() then 'active' else 'approved' end,approved_by=p_reviewer_id,approved_at=now() where id=p.id;
 elsif p_decision='reject' then update public.marketplace_promotions set status='rejected',approved_by=p_reviewer_id,approved_at=now() where id=p.id;
 else if p.approved_by is null then raise exception 'promotion_not_approved';end if;update public.marketplace_promotions set status='paused' where id=p.id;end if;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details) values(p_reviewer_id,'promotion_'||p_decision,'promotion',p.id,jsonb_build_object('note',trim(coalesce(p_note,'')),'budget_minor',p.budget_minor));
 return jsonb_build_object('id',p.id,'status',case when p_decision='approve' and p.starts_at<=now() and p.ends_at>now() then 'active' when p_decision='approve' then 'approved' else case p_decision when 'reject' then 'rejected' else 'paused' end end);
end $$;
revoke all on function public.marketplace_review_promotion(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_review_promotion(uuid,uuid,text,text) to service_role;
commit;
