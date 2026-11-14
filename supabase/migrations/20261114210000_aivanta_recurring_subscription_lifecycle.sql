-- Provider subscription identifiers, renewal history and invoice numbering.
alter table public.workspace_subscriptions
 add column if not exists provider_subscription_id text,
 add column if not exists provider_customer_id text,
 add column if not exists recurring_interval text check(recurring_interval is null or recurring_interval in ('month','year')),
 add column if not exists auto_renew boolean not null default false;
create unique index if not exists workspace_subscriptions_provider_subscription_uidx
 on public.workspace_subscriptions(provider_subscription_id) where provider_subscription_id is not null;
alter table public.billing_payments
 add column if not exists recurring_invoice_id text,
 add column if not exists recurring_cycle_start timestamptz,
 add column if not exists recurring_cycle_end timestamptz;
create table if not exists public.billing_invoice_sequences(
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 next_number bigint not null default 1 check(next_number>0),
 updated_at timestamptz not null default now()
);
alter table public.billing_invoice_sequences enable row level security;
revoke all on public.billing_invoice_sequences from public,anon,authenticated;
grant all on public.billing_invoice_sequences to service_role;
create or replace function public.next_workspace_invoice_number(p_workspace_id uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_number bigint;
begin
 if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
 insert into public.billing_invoice_sequences(workspace_id,next_number) values(p_workspace_id,2)
 on conflict(workspace_id) do update set next_number=billing_invoice_sequences.next_number+1,updated_at=now()
 returning next_number-1 into v_number;
 return 'AV-'||to_char(now(),'YYYY')||'-'||lpad(v_number::text,6,'0');
end $$;
revoke all on function public.next_workspace_invoice_number(uuid) from public,anon,authenticated;
grant execute on function public.next_workspace_invoice_number(uuid) to service_role;
