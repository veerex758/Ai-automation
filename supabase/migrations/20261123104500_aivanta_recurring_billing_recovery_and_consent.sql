-- Explicit recurring-payment consent and bounded Paystack renewal recovery.
-- Service-role only: authorization material and recovery state never reach browser clients.

create table if not exists public.billing_recurring_consents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null check (provider in ('stripe','paystack')),
  plan_slug text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  interval text not null check (interval in ('month','year')),
  terms_version text not null,
  status text not null default 'pending' check (status in ('pending','active','revoked','failed')),
  consented_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_recurring_consents_workspace_idx
  on public.billing_recurring_consents(workspace_id, created_at desc);
alter table public.billing_recurring_consents enable row level security;
revoke all on public.billing_recurring_consents from public, anon, authenticated;
grant all on public.billing_recurring_consents to service_role;

alter table public.billing_payments
  add column if not exists recurring_consent_id uuid references public.billing_recurring_consents(id) on delete set null;

create table if not exists public.billing_paystack_renewal_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period_end timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','processing','awaiting_confirmation','retry_wait','succeeded','failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  max_attempts integer not null default 3 check (max_attempts between 1 and 3),
  retry_after timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  payment_id uuid references public.billing_payments(id) on delete set null,
  last_error_code text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, period_end)
);
create index if not exists billing_paystack_renewal_jobs_due_idx
  on public.billing_paystack_renewal_jobs(status, retry_after)
  where status in ('pending','retry_wait');
create index if not exists billing_paystack_renewal_jobs_confirmation_idx
  on public.billing_paystack_renewal_jobs(updated_at)
  where status = 'awaiting_confirmation';
alter table public.billing_paystack_renewal_jobs enable row level security;
revoke all on public.billing_paystack_renewal_jobs from public, anon, authenticated;
grant all on public.billing_paystack_renewal_jobs to service_role;

alter table public.billing_payments
  add column if not exists recurring_job_id uuid references public.billing_paystack_renewal_jobs(id) on delete set null;
create index if not exists billing_payments_recurring_job_idx
  on public.billing_payments(recurring_job_id)
  where recurring_job_id is not null;

create or replace function public.claim_paystack_recurring_renewal(
  p_workspace_id uuid,
  p_period_end timestamptz,
  p_lease_seconds integer default 120
)
returns table(job_id uuid, lease_token uuid, attempt_count integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_period_end is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid renewal claim' using errcode = '22023';
  end if;

  insert into public.billing_paystack_renewal_jobs(workspace_id, period_end)
  values (p_workspace_id, p_period_end)
  on conflict (workspace_id, period_end) do nothing;

  return query
  update public.billing_paystack_renewal_jobs job
     set status = 'processing',
         attempt_count = job.attempt_count + 1,
         lease_token = gen_random_uuid(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         last_error_code = null,
         updated_at = now()
   where job.workspace_id = p_workspace_id
     and job.period_end = p_period_end
     and job.attempt_count < job.max_attempts
     and job.retry_after <= now()
     and (
       job.status in ('pending','retry_wait')
       or (job.status = 'processing' and job.lease_expires_at < now())
     )
  returning job.id, job.lease_token, job.attempt_count;
end;
$$;
revoke all on function public.claim_paystack_recurring_renewal(uuid,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.claim_paystack_recurring_renewal(uuid,timestamptz,integer) to service_role;

create or replace function public.finish_paystack_recurring_renewal(
  p_job_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_payment_id uuid default null,
  p_error_code text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_job public.billing_paystack_renewal_jobs%rowtype; v_next text; v_retry_after timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_outcome not in ('awaiting_confirmation','retry','failed') then
    raise exception 'invalid renewal outcome' using errcode = '22023';
  end if;
  select * into v_job
    from public.billing_paystack_renewal_jobs
   where id = p_job_id and lease_token = p_lease_token
     and status = 'processing'
   for update;
  if not found then
    raise exception 'renewal lease lost' using errcode = '40001';
  end if;

  if p_outcome = 'awaiting_confirmation' then
    v_next := 'awaiting_confirmation';
    v_retry_after := null;
  elsif p_outcome = 'retry' and v_job.attempt_count < v_job.max_attempts then
    v_next := 'retry_wait';
    v_retry_after := now() + make_interval(hours => case when v_job.attempt_count = 1 then 24 else 48 end);
  else
    v_next := 'failed';
    v_retry_after := null;
  end if;

  update public.billing_paystack_renewal_jobs
     set status = v_next,
         payment_id = coalesce(p_payment_id, payment_id),
         retry_after = coalesce(v_retry_after, retry_after),
         lease_token = null,
         lease_expires_at = null,
         last_error_code = case when p_error_code ~ '^[A-Z0-9_]{1,80}$' then p_error_code else null end,
         updated_at = now()
   where id = p_job_id;
  return jsonb_build_object('success', true, 'status', v_next, 'attempt_count', v_job.attempt_count);
end;
$$;
revoke all on function public.finish_paystack_recurring_renewal(uuid,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.finish_paystack_recurring_renewal(uuid,uuid,text,uuid,text) to service_role;

create or replace function public.retry_paystack_recurring_renewal(p_job_id uuid, p_error_code text default 'PAYSTACK_CHARGE_FAILED')
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_job public.billing_paystack_renewal_jobs%rowtype; v_next text; v_retry_after timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_job
    from public.billing_paystack_renewal_jobs
   where id = p_job_id and status = 'awaiting_confirmation'
   for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'renewal_not_waiting');
  end if;
  if v_job.attempt_count < v_job.max_attempts then
    v_next := 'retry_wait';
    v_retry_after := now() + make_interval(hours => case when v_job.attempt_count = 1 then 24 else 48 end);
  else
    v_next := 'failed';
    v_retry_after := null;
  end if;
  update public.billing_paystack_renewal_jobs
     set status = v_next, retry_after = coalesce(v_retry_after, retry_after),
         lease_token = null, lease_expires_at = null,
         last_error_code = case when p_error_code ~ '^[A-Z0-9_]{1,80}$' then p_error_code else 'PAYSTACK_CHARGE_FAILED' end,
         updated_at = now()
   where id = p_job_id;
  return jsonb_build_object('success', true, 'status', v_next, 'attempt_count', v_job.attempt_count);
end;
$$;
revoke all on function public.retry_paystack_recurring_renewal(uuid,text) from public, anon, authenticated;
grant execute on function public.retry_paystack_recurring_renewal(uuid,text) to service_role;

create or replace function public.complete_paystack_recurring_renewal(p_job_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.billing_paystack_renewal_jobs
     set status = 'succeeded', processed_at = now(), lease_token = null,
         lease_expires_at = null, last_error_code = null, updated_at = now()
   where id = p_job_id and status in ('processing','awaiting_confirmation','retry_wait');
  if not found then
    return jsonb_build_object('success', false, 'reason', 'renewal_not_found_or_final');
  end if;
  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.complete_paystack_recurring_renewal(uuid) from public, anon, authenticated;
grant execute on function public.complete_paystack_recurring_renewal(uuid) to service_role;
