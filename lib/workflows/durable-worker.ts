import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { decryptWorkspaceCredentials, encryptWorkspaceCredentials, type WorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
import { PROVIDER_OAUTH_CONFIG, refreshProviderOAuthToken } from "@/lib/integrations/provider-oauth";
import { decryptGoogleCredentials, encryptGoogleCredentials } from "@/lib/integrations/google-credentials";
import { GOOGLE_PRODUCTS, type GoogleProduct } from "@/lib/integrations/google-oauth";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDryRun } from "@/lib/workflows/dry-run.cjs";
import { executeRegisteredWorkflow, type RegisteredWorkflowStep } from "@/nodes/workflow-runner";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import type { NodeContext } from "@/nodes/types";
import { isProviderLiveEnabled, providerPackLiveId } from "@/lib/workflows/provider-live-gates";
import { performSafeHttpRequest } from "@/nodes/safe-http";
import { getWorkerOperationMapping, getWorkerProvider } from "@/lib/workflows/worker-operation-map";


type Job = {
  id: string; workspace_id: string; workflow_id: string; run_id: string;
  workflow_version: number; workflow_definition: Record<string, unknown>;
  execution_mode: "dry_run" | "live";
  payload: Record<string, unknown>; attempts: number; lease_token: string;
};

type DbClient = ReturnType<typeof client>;
const MAX_LIVE_ACTION_STEPS = ¶»§q«^