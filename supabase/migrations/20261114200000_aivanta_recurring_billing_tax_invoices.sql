-- Recurring billing + auditable tax invoice foundation (additive).
-- Provider credentials and customer payment methods remain server-only.
create table if not exists public.workspace_billing_customers (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 stripe_customer_id text unique,
 paystack_customer_code text,
 paystack_authorization_code_enc text,
 paystack_authorization_meta jsonb not null default '{}'::jsonb,
 recurring_provider text check(recurring_provider in ('stripe','paystack')),
 recurring_enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create table if not exists public.billing_recurring_events (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider in ('stripe','paystack')),
 event_key text not null unique,
 event_type text not null,
 workspace_id uuid references public.workspaces(id) on delete set null,
 payload_hash text not null,
 received_at timestamptz not null default now(),
 processed_at timestamptz,
 processing_error text
);
create table if not exists public.billing_invoices (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 payment_id uuid references public.billing_payments(id) on delete set null,
 invoice_number text not null,
 status text not null check(status in ('draft','issued','paid','void')),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 seller jsonb not null,
 customer jsonb not null,
 tax_jurisdiction text,
 tax_registration_id text,
 tax_rule_snapshot jsonb not null default '{}'::jsonb,
 line_items jsonb not null,
 subtotal_minor bigint not null check(subtotal_minor>=0),
 tax_minor bigint not null check(tax_minor>=0),
 total_minor bigint not null check(total_minor>=0),
 issued_at timestamptz,
 paid_at timestamptz,
 voided_at timestamptz,
 created_at timestamptz not null default now(),
 unique(workspace_id,invoice_number),
 check(total_minor=subtotal_minor+tax_minor)
);
create table if not exists public.billing_tax_rules (
 id uuid primary key default gen_random_uuid(),
 jurisdiction text not null,
 tax_code text not null,
 display_name text not null,
 rate_basis_points integer not null check(rate_basis_points between 0 and 10000),
 inclusive boolean not null default false,
 valid_from date not null,
 valid_until date,
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 check(valid_until is null or valid_until>=valid_from),
 unique(jurisdiction,tax_code,valid_from)
);
alter table public.workspace_billing_customers enable row level security;
alter table public.billing_recurring_events enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_tax_rules enable row level security;
revoke all on public.workspace_billing_customers,public.billing_recurring_events,public.billing_invoices,public.billing_tax_rules from public,anon,authenticated;
grant all on public.workspace_billing_customers,public.billing_recurring_events,public.billing_invoices,public.billing_tax_rules to service_role;
grant select on public.billing_invoices to authenticated;
drop policy if exists billing_invoices_workspace_read on public.billing_invoices;
create policy billing_invoices_workspace_read on public.billing_invoices for select to authenticated using(private.is_workspace_member(workspace_id));
comment on table public.billing_recurring_events is 'Server-only idempotency ledger for Stripe and Paystack recurring events.';
comment on table public.billing_invoices is 'Immutable issued invoice snapshots; adjustments must use credit notes/voids, never mutate issued totals.';
comment on table public.billing_tax_rules is 'Versioned tax rules; invoice issuance snapshots the applied rule and seller/customer facts.';
