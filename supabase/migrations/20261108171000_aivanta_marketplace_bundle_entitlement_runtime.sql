begin;
alter table public.marketplace_financial_ledger drop constraint if exists marketplace_financial_ledger_entry_type_check;
alter table public.marketplace_financial_ledger add constraint marketplace_financial_ledger_entry_type_check check(entry_type in ('gross_sale','platform_commission','creator_earning','processor_fee','tax','refund','chargeback','payout','adjustment','platform_commission_reversal','creator_earning_reversal'));
alter table public.marketplace_entitlements add column if not exists bundle_purchase_id uuid references public.marketplace_bundle_purchases(id) on delete restrict;
alter table public.marketplace_entitlements drop constraint if exists marketplace_entitlements_entitlement_type_check;
alter table public.marketplace_entitlements add constraint marketplace_entitlements_entitlement_type_check check(entitlement_type in ('free','purchase','subscription','admin_grant','bundle'));
create unique index if not exists marketplace_bundle_entitlement_product_unique on public.marketplace_entitlements(bundle_purchase_id,product_id) where bundle_purchase_id is not null;
create or replace function public.marketplace_install_product(p_product_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.marketplace_products;v public.marketplace_product_versions;u uuid;existing public.marketplace_installations;result public.marketplace_installations;licensed boolean:=false;
begin
 u:=auth.uid();if u is null then raise exception 'authentication_required';end if;if not private.is_workspace_member(p_workspace_id) then raise exception 'workspace_access_denied';end if;
 select * into p from public.marketplace_products where id=p_product_id for update;if not found or p.status<>'published' then raise exception 'product_not_available';end if;
 select * into v from public.marketplace_product_versions where id=p.current_version_id and product_id=p.id and verification_status='approved' for share;if not found then raise exception 'verified_version_required';end if;
 if p.pricing_type='free' then if not exists(select 1 from public.marketplace_entitlements e where e.user_id=u and e.product_id=p.id and e.status='active' and e.entitlement_type in ('free','admin_grant')) then insert into public.marketplace_entitlements(user_id,product_id,entitlement_type,status) values(u,p.id,'free','active') on conflict do nothing;end if;
 else
 select exists(select 1 from public.marketplace_licenses l where l.product_id=p.id and l.product_version_id=v.id and l.buyer_workspace_id=p_workspace_id and l.status='active' and (l.starts_at is null or l.starts_at<=now()) and (l.expires_at is null or l.expires_at>now()) and (l.license_type in ('site','enterprise') or exists(select 1 from public.marketplace_license_seats s where s.license_id=l.id and s.user_id=u and s.revoked_at is null))) into licensed;
 if not licensed and not exists(select 1 from public.marketplace_entitlements e where e.user_id=u and e.product_id=p.id and e.status='active' and e.entitlement_type in ('purchase','subscription','admin_grant','bundle') and (e.ends_at is null or e.ends_at>now()) and (e.bundle_purchase_id is null or exists(select 1 from public.marketplace_bundle_entitlements be join public.marketplace_bundle_purchases bp on bp.id=be.purchase_id join public.marketplace_bundle_versions bv on bv.id=bp.bundle_version_id where be.purchase_id=e.bundle_purchase_id and be.status='active' and bp.status='paid' and bp.buyer_user_id=u and (bv.manifest @> jsonb_build_array(jsonb_build_object('product_id',p.id,'product_version_id',v.id)))) ) then raise exception 'active_entitlement_or_license_required';end if;
 end if;
 select * into existing from public.marketplace_installations where workspace_id=p_workspace_id and product_id=p.id and status<>'removed' for update;
 if found then if existing.product_version_id<>v.id then update public.marketplace_installations set product_version_id=v.id,workflow_id=null,status='configuring',activated_at=null where id=existing.id returning * into result;else result:=existing;end if;
 else insert into public.marketplace_installations(workspace_id,product_id,product_version_id,installed_by,status,configuration) values(p_workspace_id,p.id,v.id,u,'configuring','{}'::jsonb) returning * into result;end if;
 return jsonb_build_object('installation_id',result.id,'workspace_id',result.workspace_id,'product_id',result.product_id,'product_version_id',result.product_version_id,'status',result.status,'created_at',result.installed_at);
end $$;
revoke all on function public.marketplace_install_product(uuid,uuid) from public,anon;grant execute on function public.marketplace_install_product(uuid,uuid) to authenticated;
-- Paid bundle grants are product-version scoped and are revoked on bundle refund/chargeback.
create or replace function public.marketplace_finalize_bundle_payment(p_provider text,p_event_id text,p_purchase_id uuid,p_provider_payment_id text,p_amount bigint,p_currency text,p_hash text,p_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_bundle_purchases%rowtype;fee bigint;earning bigint;ev uuid;manifest jsonb;item jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'bundle_payment_service_role_required';end if;if p_hash !~ '^[a-f0-9]{64}$' or p_amount<=0 or p_currency<>'USD' then raise exception 'invalid_bundle_payment';end if;
 select * into p from public.marketplace_bundle_purchases where id=p_purchase_id for update;if not found or p.provider<>p_provider or p.amount_minor<>p_amount or p.currency<>p_currency then raise exception 'bundle_payment_mismatch';end if;
 if p.status='paid' then if p.provider_payment_id=p_provider_payment_id then return jsonb_build_object('status','duplicate_bundle_payment');end if;raise exception 'bundle_already_paid';end if;if p.status<>'pending' then raise exception 'bundle_purchase_not_pending';end if;
 insert into public.marketplace_bundle_payment_events(provider,event_id,event_type,purchase_id,payload_sha256) values(p_provider,p_event_id,'payment.succeeded',p.id,p_hash) on conflict(provider,event_id) do nothing returning id into ev;if ev is null then return jsonb_build_object('status','duplicate_event');end if;
 fee:=floor(p_amount*0.20);earning:=p_amount-fee;update public.marketplace_bundle_purchases set status='paid',provider_payment_id=p_provider_payment_id,paid_at=coalesce(p_at,now()) where id=p.id;
 insert into public.marketplace_bundle_entitlements(buyer_user_id,bundle_id,purchase_id) values(p.buyer_user_id,p.bundle_id,p.id) on conflict(purchase_id) do nothing;
 select bv.manifest into manifest from public.marketplace_bundle_versions bv where bv.id=p.bundle_version_id;
 for item in select value from jsonb_array_elements(manifest) loop insert into public.marketplace_entitlements(user_id,product_id,entitlement_type,status,bundle_purchase_id) values(p.buyer_user_id,(item->>'product_id')::uuid,'bundle','active',p.id) on conflict do nothing;end loop;
 insert into public.marketplace_financial_ledger(bundle_purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo) values(p.id,p.creator_id,p_provider,p_event_id,'gross_sale',p_amount,p.currency,'Bundle sale'),(p.id,p.creator_id,p_provider,p_event_id,'platform_commission',fee,p.currency,'Aivanta 20% bundle commission'),(p.id,p.creator_id,p_provider,p_event_id,'creator_earning',earning,p.currency,'Creator 80% bundle earning');
 return jsonb_build_object('status','paid','bundle_purchase_id',p.id,'commission_minor',fee,'creator_earning_minor',earning);
end $$;
create or replace function public.marketplace_reverse_bundle_payment(p_provider text,p_event_id text,p_purchase_id uuid,p_kind text,p_amount bigint,p_hash text,p_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.marketplace_bundle_purchases%rowtype;prior bigint;fee bigint;earning bigint;
begin
 if auth.role()<>'service_role' then raise exception 'bundle_reversal_service_role_required';end if;if p_kind not in ('refund','chargeback') or p_hash !~ '^[a-f0-9]{64}$' or p_amount<=0 then raise exception 'invalid_bundle_reversal';end if;
 select * into p from public.marketplace_bundle_purchases where id=p_purchase_id for update;if not found or p.provider<>p_provider or p.status not in ('paid','refunded','disputed') then raise exception 'bundle_purchase_not_reversible';end if;
 if exists(select 1 from public.marketplace_bundle_payment_events where provider=p_provider and event_id=p_event_id) then return jsonb_build_object('status','duplicate_event');end if;
 select coalesce(sum(-amount_minor),0) into prior from public.marketplace_financial_ledger where bundle_purchase_id=p.id and entry_type in ('refund','chargeback');if prior+p_amount>p.amount_minor then raise exception 'bundle_reversal_exceeds_payment';end if;
 insert into public.marketplace_bundle_payment_events(provider,event_id,event_type,purchase_id,payload_sha256) values(p_provider,p_event_id,p_kind,p.id,p_hash);fee:=floor(p_amount*0.20);earning:=p_amount-fee;
 insert into public.marketplace_financial_ledger(bundle_purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo) values(p.id,p.creator_id,p_provider,p_event_id,p_kind,-p_amount,p.currency,'Bundle provider reversal');
 insert into public.marketplace_financial_ledger(bundle_purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo) values(p.id,p.creator_id,p_provider,p_event_id,'platform_commission_reversal',-fee,p.currency,'Bundle commission reversal');
 insert into public.marketplace_financial_ledger(bundle_purchase_id,creator_id,provider,provider_event_id,entry_type,amount_minor,currency,memo) values(p.id,p.creator_id,p_provider,p_event_id,'creator_earning_reversal',-earning,p.currency,'Bundle creator earning reversal');
 update public.marketplace_bundle_purchases set status=case when p_kind='chargeback' then 'disputed' else 'refunded' end,refunded_at=case when p_kind='refund' then coalesce(p_at,now()) else refunded_at end where id=p.id;
 update public.marketplace_bundle_entitlements set status='revoked' where purchase_id=p.id;update public.marketplace_entitlements set status='revoked' where bundle_purchase_id=p.id;
 return jsonb_build_object('status',p_kind,'bundle_purchase_id',p.id);
end $$;
commit;
