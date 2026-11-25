import { evaluateIfCondition, type IfComparisonOperator } from "@/nodes/core-logic";

type PlaybookRule = { id: string; nodeId: string; name: string; rationale: string };
type PlaybookPolicy = { stepId: string; nodeId: string; operationId: string; permission: "auto" | "ask_first" | "never" };
type Playbook = {
  goal: { industry: "real_estate"; outcome: string };
  rules: PlaybookRule[];
  actionPolicies: PlaybookPolicy[];
  review: { confidenceThreshold: number; reviewMissingFields: boolean; reviewWhenNoRuleMatches: boolean; reviewProviderFailures: boolean };
};
type Step = { id: string; nodeId: string; operationId: string; kind: string; input: unknown; branchPaths?: Array<Array<{ fromStepId: string; route: string }>> };
type Lead = Record<string, unknown> & { id: string; qualification?: unknown; raw_enquiry?: unknown };

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function resolveExpression(value: unknown, sample: Record<string, unknown>): { value: unknown; missing: boolean } {
  if (typeof value !== "string" || !value.startsWith("{{") || !value.endsWith("}}")) {
    return { value, missing: false };
  }
  const expression = value.slice(2, -2).trim();
  if (!/^[a-zA-Z0-9_.-]{1,200}$/.test(expression)) return { value: undefined, missing: true };
  const path = expression.replace(/^trigger\.payload\./, "").replace(/^lead\./, "");
  const resolved = readPath(sample, path);
  return { value: resolved, missing: resolved === undefined || resolved === null || resolved === "" };
}

function finiteConfidence(lead: Lead): number | null {
  const qualification = lead.qualification && typeof lead.qualification === "object" && !Array.isArray(lead.qualification)
    ? lead.qualification as Record<string, unknown>
    : {};
  const candidates = [qualification.confidence, qualification.confidenceScore, lead.ai_confidence];
  const found = candidates.find((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
  return typeof found === "number" ? found : null;
}

/**
 * Deterministic historical replay. This function does not import a provider,
 * fetch data, write rows, or dispatch workflow actions. Only the same IF
 * comparison semantics used by the workflow registry are evaluated.
 */
export function replayPlaybookAgainstLead(playbook: Playbook, steps: Step[], lead: Lead) {
  const raw = lead.raw_enquiry && typeof lead.raw_enquiry === "object" && !Array.isArray(lead.raw_enquiry)
    ? lead.raw_enquiry as Record<string, unknown>
    : {};
  // Canonical, workspace-validated columns win over raw source payload.
  // This also ensures a human correction is what deterministic rules evaluate.
  const canonicalLead = { ...raw, ...lead };
  const sample = {
    ...canonicalLead,
    trigger: { payload: canonicalLead },
    lead: canonicalLead,
  };
  const ruleByNode = new Map(playbook.rules.map((rule) => [rule.nodeId, rule]));
  const conditionSteps = steps.filter((step) => step.kind === "action" && step.nodeId === "if" && step.operationId === "evaluate");
  const rules = conditionSteps.map((step) => {
    const rule = ruleByNode.get(step.id) ?? ruleByNode.get(step.nodeId);
    const input = step.input && typeof step.input === "object" && !Array.isArray(step.input)
      ? step.input as Record<string, unknown>
      : {};
    const actual = resolveExpression(input.value, sample);
    const expected = resolveExpression(input.compareTo, sample);
    const operator = input.operator as IfComparisonOperator;
    if (actual.missing || expected.missing || typeof operator !== "string") {
      return {
        id: rule?.id ?? step.id,
        nodeId: step.id,
        name: rule?.name ?? step.id,
        rationale: rule?.rationale ?? "",
        outcome: "needs_review" as const,
        route: null,
        reason: "Required historical data for this rule is missing.",
      };
    }
    try {
      const matched = evaluateIfCondition(actual.value, expected.value, operator);
      return {
        id: rule?.id ?? step.id,
        nodeId: step.id,
        name: rule?.name ?? step.id,
        rationale: rule?.rationale ?? "",
        outcome: matched ? "matched" as const : "not_matched" as const,
        route: matched ? "true" : "false",
        reason: matched ? "The stored rule condition matched this historical enquiry." : "The stored rule condition did not match this historical enquiry.",
      };
    } catch {
      return {
        id: rule?.id ?? step.id,
        nodeId: step.id,
        name: rule?.name ?? step.id,
        rationale: rule?.rationale ?? "",
        outcome: "needs_review" as const,
        route: null,
        reason: "The stored condition could not be evaluated safely.",
      };
    }
  });

  const confidence = finiteConfidence(lead);
  const qualification = lead.qualification && typeof lead.qualification === "object" && !Array.isArray(lead.qualification)
    ? lead.qualification as Record<string, unknown>
    : {};
  const missingQualificationFields = Array.isArray(qualification.missingInformation) &&
    qualification.missingInformation.some((field) => typeof field === "string" && field.trim().length > 0);
  const missingRule = rules.some((rule) => rule.outcome === "needs_review");
  const matchedAny = rules.some((rule) => rule.outcome === "matched");
  const reasons: string[] = [];
  if (playbook.review.reviewMissingFields && (missingRule || missingQualificationFields)) {
    reasons.push(missingQualificationFields
      ? "Gemini identified required enquiry details that are still missing."
      : "A rule needs historical fields that are missing.");
  }
  if (playbook.review.reviewWhenNoRuleMatches && rules.length > 0 && !matchedAny && !missingRule) reasons.push("No business rule matched this enquiry.");
  if (playbook.review.confidenceThreshold > 0 && (confidence === null || confidence < playbook.review.confidenceThreshold)) {
    reasons.push(confidence === null ? "No recorded AI confidence score exists for this historical enquiry." : "Recorded AI confidence is below the configured threshold.");
  }

  const actions = playbook.actionPolicies.map((policy) => {
    const step = steps.find((candidate) => candidate.id === policy.stepId);
    const branchPaths = step?.branchPaths;
    const branchSelected = !branchPaths?.length || branchPaths.some((path) => path.every((condition) => {
      const selectedRule = rules.find((rule) => rule.nodeId === condition.fromStepId);
      return selectedRule?.route === condition.route;
    }));
    return {
      stepId: policy.stepId,
      nodeId: policy.nodeId,
      operationId: policy.operationId,
      permission: policy.permission,
      preview: !branchSelected ? "not_selected_by_rule" as const
        : policy.permission === "never" ? "blocked_by_policy" as const
        : policy.permission === "ask_first" ? "would_require_approval" as const
        : "would_be_eligible_after_all_runtime_checks" as const,
    };
  });

  return {
    leadId: lead.id,
    leadName: typeof lead.full_name === "string" ? lead.full_name : "Historical enquiry",
    workflowVersionIsRequired: true,
    confidence,
    confidenceThreshold: playbook.review.confidenceThreshold,
    matchedRules: rules.filter((rule) => rule.outcome === "matched").length,
    requiresReview: reasons.length > 0,
    reviewReasons: reasons,
    rules,
    actions,
    sideEffects: false as const,
    providerCalls: 0 as const,
    writes: 0 as const,
  };
}
