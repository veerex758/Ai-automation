create or replace function public.marketplace_review_creator_support_case(p_case_id uuid,p_actor_id uuid,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.marketplace_creator_support_cases%rowtype;
begin
 if auth.role()<>'service_role' or p_actor_id is null then raise exception 'support_review_service_role_required'; end if;
 if p_status not in ('under_review','resolved','closed') or length(trim(coalesce(p_note,''))) not between 3 and 1000 then raise exception 'invalid_support_review'; end if;
 select * into item from public.marketplace_creator_support_cases where id=p_case_id for update;
 if not found then raise exception 'support_case_not_found'; end if;
 if not ((item.status='submitted' and p_status in ('under_review','resolved','closed')) or
 (item.status='under_review' and p_status in ('resolved','closed')) or
 (item.status='resolved' and p_status in ('under_review','closed'))) then raise exception 'support_case_transition_invalid'; end if;
 update public.marketplace_creator_support_cases set status=p_status,updated_at=now() where id=item.id;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details)
 values(p_actor_id,'creator_support.'||p_status,'creator_support_case',item.id,jsonb_build_object('previous_status',item.status,'status',p_status,'note',trim(p_note)));
 return jsonb_build_object('id',item.id,'status',p_status,'updated_at',now());
end; $$;
revoke all on function public.marketplace_review_creator_support_case(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_review_creator_support_case(uuid,uuid,text,text) to service_role;
