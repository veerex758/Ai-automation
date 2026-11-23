-- Security-definer functions callable by authenticated workspace members must not
-- inherit the caller's search_path. Their bodies already schema-qualify relations
-- and helper functions, so an empty search_path is safe and deterministic.
alter function public.consume_agent_run_usage(uuid,uuid,text) set search_path = '';
alter function public.consume_ai_generation_usage(uuid,text) set search_path = '';
alter function public.consume_workspace_usage(uuid,text,integer,jsonb) set search_path = '';
alter function public.get_workspace_entitlements(uuid) set search_path = '';
alter function public.request_workspace_subscription_cancellation(uuid) set search_path = '';
