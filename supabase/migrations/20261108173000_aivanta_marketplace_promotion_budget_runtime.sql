-- Promotion purchase, spend, pause and refund enforcement. All money movement remains server/provider gated.
begin;
alter table public.marketplace_promotion_spend drop constraint if exists marketplace_promotion_spend_amount_minor_check;
alter table public.marketplace_promotion_spend add column if not exists entry_type text not null default 'spend' check(entry_type in ('charge','spend','refund'));
alter table public.marketplace_promotion_spend add constraint marketplace_promotion_spend_amount_check check(
 (entry_type in ('charge','spend') and amount_minor>0) or (entry_type='refund' and amount_minor<0)
);
create index if not exists marketplace_promotion_spend_campaign_idx on public.marketplace_promotion_spend(promotion_id,spent_at);
create or replace function public.marketplace_record_promotion_charge(p_promotion_id uuid,p_event_key text,p_amount_minor bigint,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_promotions%rowtype;charged bigint;spent bigint;refunded bigint;
begin
 if auth.role()<>'service_role' then raise exception 'promotion_charge_service_role_required';end if;
 if nullif(trim(p_event_key),'') is null or length(p_event_key)>200 or p_amount_minor<1000 then raise exception 'invalid_promotion_charge';end if;
 select * into p from public.marketplace_promotions where id=p_promotion_id for update;
 if not found or p.status not in ('approved','active') or p.approved_by is null or p.approved_at is null then raise exception 'promotion_not_approved';end if;
 if p.ends_at<=now() or p.starts_at>now()+interval '30 days' then raise exception 'promotion_window_invalid';end if;
 if not exists(select 1 from public.marketplace_products x join public.marketplace_product_versions v on v.id=x.current_version_id where x.id=p.product_id and x.status='published' and v.verification_status='approved') then raise exception 'promotion_product_unverified';end if;
 if exists(select 1 from public.marketplace_promotion_spend where event_key=p_event_key) then return jsonb_build_object('status','duplicate_event');end if;
 select coalesce(sum(amount_minor),0) into charged from public.marketplace_promotion_spend where promotion_id=p.id and entry_type='charge';
 select coalesce(sum(amount_minor),0) into spent from public.marketplace_promotion_spend where promotion_id=p.id and entry_type='spend';
 select coalesce(sum(-amount_minor),0) into refunded from public.marketplace_promotion_spend where promotion_id=p.id and entry_type='refund';
 if charged+p_amount_minor>p.budget_minor then raise exception 'promotion_budget_exceeded';end if;
 insert into public.marketplace_promotion_spend(promotion_id,event_key,amount_minor,currency,entry_type,metadata) values(p.id,p_event_key,p_amount_minor,p.currency,'charge',jsonb_build_object('actor_id',p_actor_id));
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details) values(p_actor_id,'promotion_charge','promotion',p.id,jsonb_build_object('amount_minor',p_amount_minor,'event_key',p_event_key));
 return jsonb_build_object('status','charged','amount_minor',p_amount_minor,'remaining_minor',p.budget_minor-charged-spent-refunded-p_amount_minor);
end $$;
create or replace function public.marketplace_record_promotion_spend(p_promotion_id uuid,p_event_key text,p_amount_minor bigint,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_promotions%rowtype;charged bigint;spent bigint;refunded bigint;
begin
 if auth.role()<>'service_role' then raise exception 'promotion_spend_service_role_required';end if;
 if nullif(trim(p_event_key),'') is null or length(p_event_key)>200 or p_amount_minor<1 then raise exception 'invalid_promotion_spend';end if;
 select * into p from public.marketplace_promotions where id=p_promotion_id for update;
 if not found or p.status<>'active' or p.approved_by is null or p.starts_at>now() or p.ends_at<=now() then raise exception 'promotion_not_spendable';end if;
 if exists(select 1 from public.marketplace_promotion_spend where event_key=p_event_key) then return jsonb_build_object('status','duplicate_event');end if;
 select coalesce(sum(amount_minor),0) into charged from public.marketplace_promotion_spend where promotion_id=p.id and entry_type='charge';
 select coalesce(sum(amount_minor),0) into spent from public.marketplace_promotion_spend where promotion_id=p.id and entry_type='spend';
 select coalesce(sum(-amount_minor),0) into refunded from public.marketplace_promotion_spend where promotion_id=p.id and entry_type='refund';
 if charged-spent-refunded<p_amount_minor then raise exception 'promotion_spend_exceeds_paid_budget';end if;
 insert into public.marketplace_promotion_spend(promotion_id,event_key,amount_minor,currency,entry_type,metadata) values(p.id,p_event_key,p_amount_minor,p.currency,'spend',coalesce(p_metadata,'{}'::jsonb));
 return jsonb_build_object('status','spent','amount_minor',p_amount_minor,'remaining_minor',charged-spent-refunded-p_amount_minor);
end $$;
create or replace function public.marketplace_refund_promotion(p_promotion_id uuid,p_event_key text,p_amount_minor bigint,p_actor_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_promotions%rowtype;charged bigint;spent bigint;refunded bigint;
begin
 if auth.role()<>'service_role' then raise exception 'promotion_refund_service_role_required';end if;
 if nullif(trim(p_event_key),'') is null or length(p_event_key)>200 or p_amount_minor<1 or length(trim(p_note))<10 or length(p_note)>1000 then raise exception 'invalid_promotion_refund';end if;
 select * into p from public.marketplace_promotions where id=p_promotion_id for update;
 if not found or p.status not in ('paused','ended','rejected') then raise exception 'promotion_refund_requires_pause_or_end';end if;
 if exists(select 1 from public.marketplace_promotion_spend where event_key=p_event_key) then return jsonb_build_object('status','duplicate_event');end if;
 select coalesce(sum(amount_minor),0) into charged from public.marketplace_promotion_spend where promotion_id=p.id and entry_type='charge';
 select coalesce(sum(amount_minor),0) into spent from public.marketplace_promotion_spend where promotion_id=p.id and entry_type='spend';
 select coalesce(sum(-amount_minor),0) into refunded from public.marketplace_promotion_spend where promotion_id=p.id and entry_type='refund';
 if p_amount_minor>charged-spent-refunded then raise exception 'promotion_refund_exceeds_unspent_balance';end if;
 insert into public.marketplace_promotion_spend(promotion_id,event_key,amount_minor,currency,entry_type,metadata) values(p.id,p_event_key,-p_amount_minor,p.currency,'refund',jsonb_build_object('actor_id',p_actor_id,'note',trim(p_note)));
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details) values(p_actor_id,'promotion_refund','promotion',p.id,jsonb_build_object('amount_minor',p_amount_minor,'event_key',p_event_key,'note',trim(p_note)));
 return jsonb_build_object('status','refunded','amount_minor',p_amount_minor,'remaining_refundable_minor',charged-spent-refunded-p_amount_minor);
end $$;
revoke all on function public.marketplace_record_promotion_charge(uuid,text,bigint,uuid) from public,anon,authenticated;
revoke all on function public.marketplace_record_promotion_spend(uuid,text,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.marketplace_refund_promotion(uuid,text,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.marketplace_record_promotion_charge(uuid,text,bigint,uuid) to service_role;
grant execute on function public.marketplace_record_promotion_spend(uuid,text,bigint,jsonb) to service_role;
grant execute on function public.marketplace_refund_promotion(uuid,text,bigint,uuid,text) to service_role;
commit;
