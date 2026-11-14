alter table public.workspace_billing_customers add column if not exists billing_customer_details jsonb not null default '{}'::jsonb;
create unique index if not exists billing_invoices_payment_uidx on public.billing_invoices(payment_id) where payment_id is not null;
