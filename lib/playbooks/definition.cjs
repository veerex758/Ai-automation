/* global module */
const schema = "rexnora.playbook";
const schemaVersion = 1;
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const permissionModes = new Set(["auto", "ask_first", "never"]);
const allowedIndustries = new Set(["real_estate"]);
const supportedActions = new Map([
  ["gemini", new Set(["qualify_real_estate_lead"])],
  ["email", new Set(["send_email"])],
  ["whatsapp_business", new Set(["send_template"])],
  ["pipedrive", new Set(["search_contacts", "execute"])],
  ["zoho_crm", new Set(["search_contacts", "execute"])],
  ["freshsales", new Set(["search_contacts", "execute"])],
  ["if", new Set(["evaluate"])],
]);
const crmProviders = new Set(["pipedrive", "zoho_crm", "freshsales"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function text(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

/**
 * A CRM contact must be created only on the explicit true branch of an IF
 * evaluator that checks whether the preceding exact-email search returned an
 * empty contacts array. Matching branch metadata on search and create is not
 * sufficient: it can make the create run unconditionally after the search.
 */
function validateCrmSearchCreateGuard(registrySteps) {
  const crmProviders = new Set(["pipedrive", "zoho_crm", "freshsales"]);
  const crmActions = registrySteps.filter((step) =>
    step && step.kind === "action" && crmProviders.has(step.nodeId)
  );
  if (!crmActions.length) return null;
  if (crmActions.length !== 2) {
    return { error: "CRM sync must contain exactly one search and one create action." };
  }
  const searchStep = crmActions.find((step) => step.operationId === "search_contacts");
  const createStep = crmActions.find((step) => step.operationId === "execute");
  if (!searchStep || !createStep || searchStep.nodeId !== createStep.nodeId) {
    return { error: "CRM sync must use one provider's exact-email search followed by its create action." };
  }
  const searchIndex = registrySteps.indexOf(searchStep);
  const createIndex = registrySteps.indexOf(createStep);
  if (searchIndex < 0 || createIndex <= searchIndex) {
    return { error: "CRM exact-email search must run before contact creation." };
  }
  const expectedReference = "{{" + searchStep.id + ".contacts}}";
  const guard = registrySteps.find((step) => {
    if (!step || step.kind !== "action" || step.nodeId !== "if" || step.operationId !== "evaluate" ||
        !isRecord(step.input)) return false;
    return step.input.value === expectedReference && step.input.operator === "is_empty";
  });
  if (!guard) {
    return {
      error: "CRM contact creation needs an IF rule that checks whether the exact-email search returned an empty contacts list.",
      failingNode: { stepId: createStep.id, nodeId: createStep.nodeId, operationId: createStep.operationId, kind: "action" },
    };
  }
  const guardIndex = registrySteps.indexOf(guard);
  if (guardIndex <= searchIndex || guardIndex >= createIndex) {
    return {
      error: "The CRM no-match IF rule must run after contact search and before contact creation.",
      failingNode: { stepId: createStep.id, nodeId: createStep.nodeId, operationId: createStep.operationId, kind: "action" },
    };
  }
  const paths = Array.isArray(createStep.branchPaths)
    ? createStep.branchPaths
    : createStep.branch ? [[createStep.branch]] : [];
  const createOnlyOnNoMatch = paths.length > 0 && paths.every((path) =>
    Array.isArray(path) &&
    path.some((predicate) => predicate && predicate.fromStepId === guard.id && predicate.route === "true") &&
    !path.some((predicate) => predicate && predicate.fromStepId === guard.id && predicate.route !== "true")
  );
  if (!createOnlyOnNoMatch) {
    return {
      error: "CRM contact creation must be reachable only through the true branch of the empty-search-result IF rule. This prevents duplicate contacts.",
      failingNode: { stepId: createStep.id, nodeId: createStep.nodeId, operationId: createStep.operationId, kind: "action" },
    };
  }
  if ((searchStep.connectionId ?? null) !== (createStep.connectionId ?? null)) {
    return {
      error: "CRM search and create must use the same selected workspace connection.",
      failingNode: { stepId: createStep.id, nodeId: createStep.nodeId, operationId: createStep.operationId, kind: "action" },
    };
  }
  return null;
}

/**
 * Validates the customer-facing Playbook policy envelope against the exact
 * validated graph and registry execution plan. The graph remains the canonical
 * source for predicates and topology; this envelope adds business intent,
 * human-readable rule labels, review thresholds and explicit action permissions.
 *
 * This function is validation only. It does not authorize or execute actions.
 */
function validatePlaybookDefinition(value, definition, registrySteps) {
  if (!isRecord(value)) return { error: "Playbook settings must be an object." };
  if (!exactKeys(value, ["schema", "schemaVersion", "goal", "rules", "actionPolicies", "review"])) {
    return { error: "Playbook settings contain an unsupported field." };
  }
  if (value.schema !== schema || value.schemaVersion !== schemaVersion) {
    return { error: "Unsupported Playbook schema version. Refresh and configure this Playbook again." };
  }
  if (!isRecord(definition) || !Array.isArray(definition.nodes) || !Array.isArray(registrySteps)) {
    return { error: "A Playbook must be bound to a validated workflow graph and registered execution plan." };
  }

  const goal = value.goal;
  if (!isRecord(goal) || !exactKeys(goal, ["industry", "outcome"]) ||
      !allowedIndustries.has(goal.industry) || !text(goal.outcome, 240)) {
    return { error: "Choose a supported industry and describe the Playbook outcome in 1–240 characters." };
  }

  const conditionNodes = definition.nodes.filter((node) => node && node.type === "condition");
  if (!Array.isArray(value.rules) || value.rules.length !== conditionNodes.length || value.rules.length > 30) {
    return { error: "Every IF condition in the graph must have exactly one matching Playbook rule." };
  }
  const conditionIds = new Set(conditionNodes.map((node) => node.id));
  const ruleIds = new Set();
  const ruleNodeIds = new Set();
  const rules = [];
  for (const candidate of value.rules) {
    if (!isRecord(candidate) || !exactKeys(candidate, ["id", "nodeId", "name", "rationale"]) ||
        typeof candidate.id !== "string" || !idPattern.test(candidate.id) ||
        typeof candidate.nodeId !== "string" || !conditionIds.has(candidate.nodeId) ||
        !text(candidate.name, 100) || (candidate.rationale !== undefined && candidate.rationale !== null && (typeof candidate.rationale !== "string" || candidate.rationale.length > 240))) {
      return { error: "Each Playbook rule must name one existing IF condition and include a clear label." };
    }
    if (ruleIds.has(candidate.id) || ruleNodeIds.has(candidate.nodeId)) {
      return { error: "Playbook rule IDs and condition bindings must be unique." };
    }
    ruleIds.add(candidate.id);
    ruleNodeIds.add(candidate.nodeId);
    rules.push({
      id: candidate.id,
      nodeId: candidate.nodeId,
      name: candidate.name.trim(),
      rationale: typeof candidate.rationale === "string" ? candidate.rationale.trim() : "",
    });
  }
  if ([...conditionIds].some((id) => !ruleNodeIds.has(id))) {
    return { error: "A graph condition is missing its matching Playbook rule." };
  }

  const qualificationActions = registrySteps.filter((step) => step && step.kind === "action" && step.nodeId === "gemini" && step.operationId === "qualify_real_estate_lead");
  const agencyEmailActions = registrySteps.filter((step) => step && step.kind === "action" && step.nodeId === "email" && step.operationId === "send_email");
  const whatsappActions = registrySteps.filter((step) => step && step.kind === "action" && step.nodeId === "whatsapp_business" && step.operationId === "send_template");
  const crmActions = registrySteps.filter((step) => step && step.kind === "action" && crmProviders.has(step.nodeId));
  const conditionSteps = registrySteps.filter((step) => step && step.kind === "action" && step.nodeId === "if" && step.operationId === "evaluate");
  if (qualificationActions.length !== 1) return { error: "A real-estate Playbook must contain exactly one Gemini lead-qualification action." };
  if (agencyEmailActions.length > 1) return { error: "A real-estate Playbook can contain at most one agency email notification action." };
  if (whatsappActions.length > 1) return { error: "A real-estate Playbook can contain at most one consent-based WhatsApp template action." };
  const crmProvidersUsed = [...new Set(crmActions.map((step) => step.nodeId))];
  if (crmProvidersUsed.length > 1) return { error: "A real-estate Playbook can sync to only one CRM provider at a time." };
  if (crmActions.length && (crmActions.length !== 2 ||
      !crmActions.some((step) => step.operationId === "search_contacts") ||
      !crmActions.some((step) => step.operationId === "execute"))) {
    return { error: "A CRM sync must contain one exact-email search followed by one create-contact action." };
  }
  if (crmActions.length === 2) {
    const searchIndex = registrySteps.indexOf(crmActions.find((step) => step.operationId === "search_contacts"));
    const createIndex = registrySteps.indexOf(crmActions.find((step) => step.operationId === "execute"));
    if (searchIndex < 0 || createIndex <= searchIndex) return { error: "CRM exact-email search must run before contact creation." };
    const searchStep = crmActions.find((step) => step.operationId === "search_contacts");
    const createStep = crmActions.find((step) => step.operationId === "execute");
    const crmGuardError = validateCrmSearchCreateGuard(registrySteps);
    if (crmGuardError) return { error: crmGuardError.error };
  }
  const conditionStepIds = new Set(conditionSteps.map((step) => step.id));
  if (conditionSteps.length !== conditionNodes.length || [...conditionIds].some((id) => !conditionStepIds.has(id))) {
    return { error: "Every Playbook rule must be backed by one registered IF evaluator in the saved graph." };
  }
  const qualificationIndex = registrySteps.findIndex((step) => step === qualificationActions[0]);
  const externalActionIndexes = [
    ...agencyEmailActions,
    ...whatsappActions,
    ...crmActions,
  ].map((step) => registrySteps.indexOf(step));
  const crmSearch = crmActions.find((step) => step.operationId === "search_contacts");
  if (conditionSteps.some((step) => registrySteps.indexOf(step) < qualificationIndex)) {
    return { error: "Gemini qualification must precede deterministic Playbook rules so rules evaluate the saved qualification result." };
  }
  if (externalActionIndexes.some((index) => conditionSteps.some((step) => registrySteps.indexOf(step) > index))) {
    return { error: "Every deterministic Playbook rule must be evaluated before customer communication or CRM writes." };
  }
  if (crmSearch && registrySteps.indexOf(crmSearch) < qualificationIndex) {
    return { error: "Gemini qualification must precede CRM sync." };
  }

  // IF evaluator operations are deterministic predicates, not external
  // actions. Every other registered action step must have an explicit policy.
  for (const step of registrySteps) {
    if (step && step.kind === "action") {
      const operations = supportedActions.get(step.nodeId);
      if (!operations || !operations.has(step.operationId)) {
        return { error: "Unsupported real-estate Playbook action: " + step.nodeId + "." + step.operationId + ". Only reviewed Gemini, IF, Resend, consent-gated WhatsApp templates and exact-search CRM actions are allowed." };
      }
    }
  }
  const actionableSteps = registrySteps.filter((step) =>
    step && step.kind === "action" && step.nodeId !== "if"
  );
  if (!Array.isArray(value.actionPolicies) || value.actionPolicies.length !== actionableSteps.length) {
    return { error: "Every registered action needs exactly one auto, ask first, or never permission." };
  }
  const policiesByStep = new Map();
  for (const candidate of value.actionPolicies) {
    if (!isRecord(candidate) || !exactKeys(candidate, ["stepId", "nodeId", "operationId", "permission"]) ||
        typeof candidate.stepId !== "string" || !idPattern.test(candidate.stepId) ||
        typeof candidate.nodeId !== "string" || !text(candidate.operationId, 128) ||
        !permissionModes.has(candidate.permission)) {
      return { error: "Each action permission must identify a registered step and use auto, ask_first, or never." };
    }
    if (policiesByStep.has(candidate.stepId)) return { error: "An action cannot have duplicate permission settings." };
    policiesByStep.set(candidate.stepId, candidate);
  }
  const actionPolicies = [];
  for (const step of actionableSteps) {
    const policy = policiesByStep.get(step.id);
    if (!policy || policy.nodeId !== step.nodeId || policy.operationId !== step.operationId) {
      return { error: "Action permissions do not match the saved registered operations. Review each changed action before saving." };
    }
    actionPolicies.push({
      stepId: step.id,
      nodeId: step.nodeId,
      operationId: step.operationId,
      permission: policy.permission,
    });
  }

  const review = value.review;
  if (!isRecord(review) || !exactKeys(review, [
    "confidenceThreshold",
    "reviewMissingFields",
    "reviewWhenNoRuleMatches",
    "reviewProviderFailures",
  ]) || typeof review.confidenceThreshold !== "number" ||
      !Number.isFinite(review.confidenceThreshold) || review.confidenceThreshold < 0 || review.confidenceThreshold > 1 ||
      typeof review.reviewMissingFields !== "boolean" ||
      typeof review.reviewWhenNoRuleMatches !== "boolean" ||
      typeof review.reviewProviderFailures !== "boolean") {
    return { error: "Configure a confidence threshold from 0 to 1 and explicit review rules for missing data, unmatched rules and provider failures." };
  }

  return {
    playbook: {
      schema,
      schemaVersion,
      goal: { industry: goal.industry, outcome: goal.outcome.trim() },
      rules,
      actionPolicies,
      review: {
        confidenceThreshold: review.confidenceThreshold,
        reviewMissingFields: review.reviewMissingFields,
        reviewWhenNoRuleMatches: review.reviewWhenNoRuleMatches,
        reviewProviderFailures: review.reviewProviderFailures,
      },
    },
  };
}

module.exports = { validatePlaybookDefinition, validateCrmSearchCreateGuard };
