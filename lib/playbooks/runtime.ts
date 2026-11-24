import "server-only";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import playbookDefinition from "@/lib/playbooks/definition.cjs";

const { validatePlaybookDefinition } = playbookDefinition;
type Permission = "auto" | "ask_first" | "never";
type DecisionType = "action_approval" | "qualification_review" | "provider_failure";
type RegisteredStep = { id: string; nodeId: string; operationId: string; kind: string; input: Record<string, unknown>; branch?: { fromStepId: string; route: string } };
type Policy = { stepId: string; nodeId: string; operationId: string; permission: Permission };
type Playbook = {
  schema: "rexnora.playbook";
  schemaVersion: 1;
  goal: { industry: "real_estate"; outcome: string };
  rules: Array<{ id: string; nodeId: string; name: string; rationale: string }>;
  actionPolicies: Policy[];
  review: { confidenceThreshold: number; reviewMissingFields: boolean; reviewWhenNoRuleMatches: boolean; reviewProviderFailures: boolean };
};
export type PlaybookRuntime = {
  mode: "legacy" | "playbook" | "invalid";
  reason?: string;
  workflowId?: string;
  version?: number;
  definition?: Playbook;
  steps?: RegisteredStep[];
  policies?: Policy[];
};
export type PlaybookLeadBinding = {
  id: string;
  workspace_id: string;
  workflow_id?: string | null;
  playbook_version?: number | null;
};

type Db = ReturnType<typeof createRealEstateServiceClient>;

export async function loadPlaybookRuntime(db: Db, lead: PlaybookLeadBinding): Promise<PlaybookRuntime> {
  if (!lead.workflow_id || !lead.playbook_version) return { mode: "legacy" };
  const [{ data: workflow, error: workflowError }, { data: versionRow, error: versionError }] = await Promise.all([
    db.from("workflows").select("id,workspace_id,status,version")
      .eq("id", lead.workflow_id).eq("workspace_id", lead.workspace_id).maybeSingle(),
    db.from("workflow_versions").select("definition")
      .eq("workflow_id", lead.workflow_id).eq("version", lead.playbook_version).maybeSingle(),
  ]);
  if (workflowError || versionError) return { mode: "invalid", reason: "PLAYBOOK_VERSION_LOOKUP_FAILED" };
  if (!workflow || workflow.status !== "active" || workflow.version !== lead.playbook_version || !versionRow?.definition) {
    return { mode: "invalid", workflowId: lead.workflow_id, version: lead.playbook_version, reason: "PLAYBOOK_VERSION_NOT_ACTIVE" };
  }
  const stored = versionRow.definition as Record<string, unknown>;
  if (!stored || stored.format !== "aivanta-registry-v1" || !stored.playbook) {
    return { mode: "invalid", workflowId: workflow.id, version: lead.playbook_version, reason: "PLAYBOOK_DEFINITION_MISSING" };
  }
  const graph = validateDefinition(stored);
  if (!graph.definition) return { mode: "invalid", workflowId: workflow.id, version: lead.playbook_version, reason: "PLAYBOOK_GRAPH_INVALID" };
  const registry = validateRegisteredSteps(stored.steps);
  if (!registry.steps) return { mode: "invalid", workflowId: workflow.id, version: lead.playbook_version, reason: "PLAYBOOK_OPERATIONS_INVALID" };
  const checked = validatePlaybookDefinition(stored.playbook, graph.definition, registry.steps);
  if (!checked.playbook) return { mode: "invalid", workflowId: workflow.id, version: lead.playbook_version, reason: "PLAYBOOK_POLICY_INVALID" };
  return {
    mode: "playbook",
    workflowId: workflow.id,
    version: lead.playbook_version,
    definition: checked.playbook as Playbook,
    steps: registry.steps as RegisteredStep[],
    policies: checked.playbook.actionPolicies as Policy[],
  };
}

export function getPlaybookPolicy(runtime: PlaybookRuntime, nodeId: string, operationId: string): Policy | null {
  if (runtime.mode !== "playbook") return null;
  return runtime.policies?.find((policy) => policy.nodeId === nodeId && policy.operationId === operationId) ?? null;
}

export function isPlaybookActionOnSelectedBranch(
  runtime: PlaybookRuntime,
  policy: Policy,
  ruleResults: Array<{ nodeId: string; route: string | null }>,
): boolean {
  if (runtime.mode !== "playbook") return false;
  const step = runtime.steps?.find((candidate) => candidate.id === policy.stepId);
  if (!step?.branch) return true;
  const selected = ruleResults.find((rule) => rule.nodeId === step.branch?.fromStepId);
  return selected?.route === step.branch.route;
}

export async function requestOrReadPlaybookDecision(args: {
  db: Db;
  lead: PlaybookLeadBinding;
  runtime: PlaybookRuntime;
  type: DecisionType;
  reason: string;
  policy?: Policy | null;
  nodeId?: string | null;
  operationId?: string | null;
  leaseToken: string;
}): Promise<{ state: "allow" | "pending" | "denied"; decisionId?: string }> {
  const { db, lead, runtime } = args;
  if (runtime.mode !== "playbook" || !runtime.workflowId || !runtime.version) return { state: "denied" };
  const permission = args.policy?.permission ?? (args.type === "qualification_review" ? "ask_first" : null);
  if (permission === "never") return { state: "denied" };
  if (args.type === "action_approval" && permission === "auto") return { state: "allow" };
  if (args.type !== "action_approval" && args.type !== "qualification_review" && args.type !== "provider_failure") return { state: "denied" };
  const stepId = args.policy?.stepId ?? null;
  const nodeId = args.policy?.nodeId ?? args.nodeId ?? null;
  const operationId = args.policy?.operationId ?? args.operationId ?? null;
  const idempotencyKey = [
    "pb", runtime.workflowId, runtime.version, lead.id, args.type,
    stepId ?? nodeId ?? "review", operationId ?? "none",
  ].join(":").slice(0, 240);
  const { data: prior, error: priorError } = await db.from("real_estate_playbook_decisions")
    .select("id,status,expires_at")
    .eq("workspace_id", lead.workspace_id).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (priorError) throw new Error("PLAYBOOK_DECISION_LOOKUP_FAILED");
  let decision = prior;
  if (!decision) {
    const { data: created, error: createError } = await db.from("real_estate_playbook_decisions").insert({
      workspace_id: lead.workspace_id,
      workflow_id: runtime.workflowId,
      workflow_version: runtime.version,
      lead_id: lead.id,
      decision_type: args.type,
      step_id: stepId,
      node_id: nodeId,
      operation_id: operationId,
      permission: permission === "auto" ? "review" : "ask_first",
      status: "pending",
      reason: args.reason.slice(0, 500),
      safe_details: { nodeId, operationId, stepId, decisionType: args.type },
      idempotency_key: idempotencyKey,
    }).select("id,status,expires_at").single();
    if (createError && createError.code !== "23505") throw new Error("PLAYBOOK_DECISION_CREATE_FAILED");
    if (created) {
      decision = created;
      await db.from("real_estate_lead_activities").insert({
        workspace_id: lead.workspace_id,
        lead_id: lead.id,
        actor_user_id: null,
        activity_type: "lead.playbook_decision_requested",
        details: {
          decisionId: created.id,
          decisionType: args.type,
          workflowVersion: runtime.version,
          stepId,
          nodeId,
          operationId,
          reason: args.reason.slice(0, 500),
        },
      });
    } else {
      const { data: raced, error: racedError } = await db.from("real_estate_playbook_decisions")
        .select("id,status,expires_at").eq("workspace_id", lead.workspace_id).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (racedError || !raced) throw new Error("PLAYBOOK_DECISION_RACE_FAILED");
      decision = raced;
    }
  }
  if (decision.status === "approved" || decision.status === "executed") return { state: "allow", decisionId: decision.id };
  if (decision.status !== "pending" || new Date(decision.expires_at).getTime() <= Date.now()) return { state: "denied", decisionId: decision.id };

  const { data: paused, error: pauseError } = await db.from("real_estate_leads").update({
    pipeline_status: "blocked",
    pipeline_next_attempt_at: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    pipeline_last_error_code: "PLAYBOOK_APPROVAL_REQUIRED",
    pipeline_lease_token: null,
    pipeline_lease_until: null,
    ...(args.type === "action_approval" && nodeId === "gemini" ? { qualification_status: "blocked" } : {}),
    ...(args.type === "action_approval" && nodeId === "email" ? { agent_notification_status: "blocked" } : {}),
    ...(args.type === "provider_failure" && nodeId === "gemini" ? { qualification_status: "blocked" } : {}),
    ...(args.type === "provider_failure" && nodeId === "email" ? { agent_notification_status: "blocked" } : {}),
  }).eq("id", lead.id).eq("workspace_id", lead.workspace_id).eq("pipeline_lease_token", args.leaseToken).select("id").maybeSingle();
  if (pauseError || !paused) throw new Error("PLAYBOOK_APPROVAL_PAUSE_FAILED");
  return { state: "pending", decisionId: decision.id };
}

export async function markPlaybookDecisionExecuted(db: Db, lead: PlaybookLeadBinding, decisionId?: string) {
  if (!decisionId) return;
  const { data, error } = await db.from("real_estate_playbook_decisions")
    .update({ status: "executed", executed_at: new Date().toISOString() })
    .eq("id", decisionId).eq("workspace_id", lead.workspace_id).eq("status", "approved")
    .select("id,workflow_version,decision_type,step_id,node_id,operation_id").maybeSingle();
  if (error) throw new Error("PLAYBOOK_DECISION_COMPLETE_FAILED");
  if (data) {
    await db.from("real_estate_lead_activities").insert({
      workspace_id: lead.workspace_id,
      lead_id: lead.id,
      actor_user_id: null,
      activity_type: "lead.playbook_action_executed",
      details: {
        decisionId: data.id,
        workflowVersion: data.workflow_version,
        decisionType: data.decision_type,
        stepId: data.step_id,
        nodeId: data.node_id,
        operationId: data.operation_id,
      },
    });
  }
}

export async function pausePlaybookLead(db: Db, lead: PlaybookLeadBinding, leaseToken: string, code: string) {
  const { data, error } = await db.from("real_estate_leads").update({
    pipeline_status: "blocked",
    pipeline_next_attempt_at: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    pipeline_last_error_code: code,
    pipeline_lease_token: null,
    pipeline_lease_until: null,
  }).eq("id", lead.id).eq("workspace_id", lead.workspace_id).eq("pipeline_lease_token", leaseToken).select("id").maybeSingle();
  if (error || !data) throw new Error("PLAYBOOK_LEAD_PAUSE_FAILED");
}
