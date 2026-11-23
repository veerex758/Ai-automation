alter table public.billing_payments add column if not exists recurring_setup boolean not null default false;
