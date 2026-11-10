begin;
create table if not exists public.marketplace_bundle_versions(
 id uuid primary key default gen_random_uuid(),bundle_id uuid not null references public.marketplace_bundles(id) on delete restrict,
 version integer not null check(version>0),manifest jsonb not null check(jsonb_typeof(manifest)='array'),
 manifest_sha256 char(64) not null check(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 verification_status text not null default 'pending' check(verification_status in ('pending','approved','rejected','revoked')),
 verified_by uuid references auth.users(id) on delete restrict,verified_at timestamptz,created_at timestamptz not null default now(),unique(bundle_id,version),unique(bundle_id,manifest_sha256),
 check((verification_status='approved' and verified_by is not null and verified_at is not null) or verification_status<>'approved')
);
alter table public.marketplace_bundles add column if not exists current_version_id uuid references public.marketplace_bundle_versions(id) on delete restrict;
drop policy if exists marketplace_bundles_public_verified on public.marketplace_bundles;
create policy marketplace_bundles_public_verified on public.marketplace_bundles for select to anon,authenticated using(
 status='published' and exists(select 1 from public.marketplace_bundle_versions bv where bv.id=current_version_id and bv.verification_status='approved' and bv.manifest_sha256=encode(digest(bv.manifest::text,'sha256'),'hex'))
 and exists(select 1 from public.marketplace_bundle_items bi where bi.bundle_id=marketplace_bundles.id)
 and not exists(select 1 from public.marketplace_bundle_items bi join public.marketplace_products p on p.id=bi.product_id join public.marketplace_product_versions pv on pv.id=bi.product_version_id and pv.product_id=p.id where bi.bundle_id=marketplace_bundles.id and (p.status<>'published' or p.current_version_id<>pv.id or pv.verification_status<>'approved'))
);

alter table public.marketplace_bundle_versions enable row level security;
revoke all on public.marketplace_bundle_versions from anon,authenticated;
grant all on public.marketplace_bundle_versions to service_role;
create or replace function public.marketplace_submit_bundle(p_bundle_id uuid,p_creator_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.marketplace_bundles%rowtype;manifest jsonb;sha text;ver integer;v public.marketplace_bundle_versions%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'bundle_submit_service_role_required';end if;
 select * into b from public.marketplace_bundles where id=p_bundle_id and creator_id=p_creator_id for update;if not found or b.status<>'draft' then raise exception 'bundle_not_editable';end if;
 select jsonb_agg(jsonb_build_object('product_id',bi.product_id,'product_version_id',bi.product_version_id,'position',bi.position) order by bi.position) into manifest from public.marketplace_bundle_items bi where bi.bundle_id=b.id;
 if manifest is null or jsonb_array_length(manifest)=0 then raise exception 'bundle_items_required';end if;
 if b.pricing_type='free' and exists(select 1 from public.marketplace_bundle_items bi join public.marketplace_products p on p.id=bi.product_id where bi.bundle_id=b.id and p.pricing_type<>'free') then raise exception 'free_bundle_contains_paid_product';end if;
 if exists(select 1 from public.marketplace_bundle_items bi join public.marketplace_products p on p.id=bi.product_id join public.marketplace_product_versions pv on pv.id=bi.product_version_id and pv.product_id=p.id where bi.bundle_id=b.id and (p.status<>'published' or p.current_version_id<>pv.id or pv.verification_status<>'approved')) then raise exception 'bundle_contains_unverified_product';end if;
 sha:=encode(digest(manifest::text,'sha256'),'hex');select coalesce(max(version),0)+1 into ver from public.marketplace_bundle_versions where bundle_id=b.id;
 insert into public.marketplace_bundle_versions(bundle_id,version,manifest,manifest_sha256) values(b.id,ver,manifest,sha) returning * into v;
 update public.marketplace_bundles set status='submitted',current_version_id=v.id,updated_at=now() where id=b.id;
 return jsonb_build_object('bundle_id',b.id,'version_id',v.id,'version',ver,'manifest_sha256',sha,'status','pending');
end $$;
create or replace function public.marketplace_review_bundle(p_bundle_version_id uuid,p_reviewer_id uuid,p_decision text,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.marketplace_bundle_versions%rowtype;b public.marketplace_bundles%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'bundle_review_service_role_required';end if;
 if p_decision not in ('approve','reject') or length(trim(coalesce(p_note,'')))>1000 then raise exception 'invalid_bundle_review';end if;
 select * into v from public.marketplace_bundle_versions where id=p_bundle_version_id for update;if not found then raise exception 'bundle_version_not_found';end if;
 select * into b from public.marketplace_bundles where id=v.bundle_id for update;if b.status<>'submitted' or b.current_version_id<>v.id then raise exception 'bundle_review_not_current';end if;
 if p_decision='approve' then if exists(select 1 from jsonb_array_elements(v.manifest) as x(item) join public.marketplace_products p on p.id=(x.item->>'product_id')::uuid join public.marketplace_product_versions pv on pv.id=(x.item->>'product_version_id')::uuid and pv.product_id=p.id where p.status<>'published' or p.current_version_id<>pv.id or pv.verification_status<>'approved') then raise exception 'bundle_version_stale';end if;
 update public.marketplace_bundle_versions set verification_status='approved',verified_by=p_reviewer_id,verified_at=now() where id=v.id;update public.marketplace_bundles set status='published',published_at=now(),updated_at=now() where id=b.id;
 else update public.marketplace_bundle_versions set verification_status='rejected' where id=v.id;update public.marketplace_bundles set status='draft',current_version_id=null,updated_at=now() where id=b.id;end if;
 insert into public.marketplace_admin_audit(actor_id,action,entity_type,entity_id,details) values(p_reviewer_id,'bundle_'||p_decision,'bundle',b.id,jsonb_build_object('bundle_version_id',v.id,'manifest_sha256',v.manifest_sha256,'note',trim(coalesce(p_note,''))));
 return jsonb_build_object('bundle_id',b.id,'version_id',v.id,'status',case p_decision when 'approve' then 'published' else 'draft' end);
end $$;
revoke all on function public.marketplace_submit_bundle(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_submit_bundle(uuid,uuid) to service_role;
revoke all on function public.marketplace_review_bundle(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketplace_review_bundle(uuid,uuid,text,text) to service_role;
commit;
