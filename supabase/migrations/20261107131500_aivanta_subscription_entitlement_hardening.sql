-- Phase 5 hardening: serialize usage reservations and enforce active workflow caps at write time.
-- This migration is additive and safe to replay on a clean database.

alter table public.workspace_subscriptions
  add column if not exists custom_workflow_limit integer check (custom_workflow_limit is null or custom_workflow_limit >= 0),
  add column if not exists custom_execution_limit integer check (custom_execution_limit is null or custom_execution_limit >= 0),
  add column if not exists custom_ai_credit_limit integer check (custom_ai_credit_limit is null or custom_ai_credit_limit >= 0);
alter table public.workspace_subscriptions drop constraint if exists workspace_subscriptions_plan_key_check;
alter table public.workspace_subscriptions
  add constraint workspace_subscriptions_plan_key_check
  check (plan_key in ('free','starter','pro','business','enterprise'));
alter table public.workspace_subscriptions drop constraint if exists workspace_subscriptions_enterprise_limits_check;
alter table public.workspace_subscriptions
  add constraint workspace_subscriptions_enterprise_limits_check
  check (plan_key <> 'enterprise' or (
    custom_workflow_limit is not null
    and custom_execution_limit is not null
    and custom_ai_credit_limit is not null
  ));

create unique index if not exists workspace_usage_idempotency_uidx
  on public.workspace_usage (workspace_id, metric, (metadata ->> 'idempotency_key'))
  where nullif(metadata ->> 'idempotency_key','') is not null;

create or r¶»§q«^