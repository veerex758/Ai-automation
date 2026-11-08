begin;
create or replace function public.marketplace_review_refund_request(p_request_id uuid,p_reviewer_id uuid,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.marketplace_refund_requests%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'refund_review_service_role_required';end if;
 if p_status not in ('under_review','approved','rejected') or length(trim(p_note)) not between 5 and 1000 then raise exception 'invalid_refund_review';end if;
 select * into r from public.marketplace_refund_requests where id=p_request_id for update;
 if not found then raise exception 'refund_request_not_found';end if;
 if r.status not in ('requested','under_review') then raise exception 'refund_request_resolved';end if;
 update public.marketplace_refund_requests set status=p_status,reviewer_user_id=p_reviewer_id,review_note=trim(p_note),reviewed_at=now() where id=r.id;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details) values(p_reviewer_id,'refund_request_'||p_status,'refund_request',r.id,jsonb_build_object('purchase_id',r.purchase_id,'note',trim(p_note)));
 return jsonb_build_object('id',r.id,'status',p_status,'reviewed_at',now());
end $$;
revoke all on function public.marketplace_review_refund_request(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_review_refund_request(uuid,uuid,text,text) to service_role;
commit;
