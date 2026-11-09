-- Phase A customer notices and emergency install suspension are wired to product/version trust changes.
create or replace function public.marketplace_emit_customer_trust_notices()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare notice_kind text; notice_title text; notice_body text; should_pause boolean:=false;
begin
 if tg_table_name='marketplace_products' then
  if new.status is distinct from old.status and new.status in ('suspended','revoked','archived') then
   should_pause:=true;
   notice_kind:=case when new.status='revoked' then 'verification_revoked' when new.status='suspended' then 'product_suspended' else 'product_removed' end;
   notice_title:=case when new.status='revoked' then 'Marketplace verification revoked' when new.status='suspended' then 'Marketplace product suspended' else 'Marketplace product removed' end;
   notice_body:='This product was '||new.status||' by marketplace moderation. Existing installations have been paused; do not resume until Aivanta resolves the notice.';
  elsif new.current_version_id is distinct from old.current_version_id then
   notice_kind:='update_available';notice_title:='Verified product update available';notice_body:='A new verified version is available. Review its changelog and permissions before updating.';
  elsif new.permissions is distinct from old.permissions or new.integrations is distinct from old.integrations then
   notice_kind:='permission_change';notice_title:='Marketplace permissions or integrations changed';notice_body:='The product permissions or required integrations changed. Review the listing before updating or activating.';
  else return new;
  end if;
  if should_pause then
   update public.workflows w set status='paused',updated_at=now() from public.marketplace_installations i where i.product_id=new.id and i.workflow_id=w.id and i.status='active';
   update public.marketplace_installations set status='paused' where product_id=new.id and status='active';
  end if;
  insert into public.marketplace_customer_notices(user_id,product_id,installation_id,notice_type,title,body)
  select distinct i.installed_by,new.id,i.id,notice_kind,notice_title,notice_body from public.marketplace_installations i where i.product_id=new.id and i.status<>'removed';
  return new;
 else
  if old.verification_status='approved' and new.verification_status='revoked' then
   update public.marketplace_products set status='revoked',updated_at=now() where id=new.product_id and current_version_id=new.id and status in ('published','verified');
  end if;
  return new;
 end if;
end $$;
drop trigger if exists marketplace_product_customer_trust_notice on public.marketplace_products;
create trigger marketplace_product_customer_trust_notice after update of status,current_version_id,permissions,integrations on public.marketplace_products for each row execute function public.marketplace_emit_customer_trust_notices();
drop trigger if exists marketplace_version_revocation_notice on public.marketplace_product_versions;
create trigger marketplace_version_revocation_notice after update of verification_status on public.marketplace_product_versions for each row execute function public.marketplace_emit_customer_trust_notices();
revoke all on function public.marketplace_emit_customer_trust_notices() from public,anon,authenticated;
