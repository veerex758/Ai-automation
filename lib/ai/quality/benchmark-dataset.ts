import type { AITask, AIToolDefinition, AIToolOutput } from "../types";

export type AIQualityGrade = {
  schemaValid: boolean | null;
  taskCorrect: boolean;
  workflowGraphCorrectness?: boolean;
  toolCallAccuracy?: boolean;
};
export type AIQualityCase = {
  id: string;
  task: AITask;
  mode: "structured" | "text" | "tools";
  prompt: string;
  systemPrompt: string;
  expected: unknown;
  tools?: AIToolDefinition[];
  grade: (output: unknown) => AIQualityGrade;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function text(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}
function hasAll(value: unknown, terms: string[]): boolean {
  const actual = text(value);
  return terms.every((term) => actual.includes(term.toLowerCase()));
}

const leads: AIQualityCase[] = Array.from({ length: 20 }, (_, i) => {
  const budget = 180_000 + i * 23_500;
  const timeline = 30 + (i * 17) % 150;
  const area = ["Lekki", "Yaba", "Ikeja", "Ajah", "Ikoyi"][i % 5];
  const qualified = budget >= 250_000 && timeline <= 90;
  const expected = { isQualified: qualified, budgetUsd: budget, preferredArea: area, timelineDays: timeline };
  return {
    id: "lead-" + (i + 1), task: "lead_qualification", mode: "structured",
    systemPrompt: "Classify the property lead using budgetUsd >= 250000 and timelineDays <= 90. Return only JSON with isQualified, budgetUsd, preferredArea, timelineDays. Do not infer or alter facts.",
    prompt: "Lead facts: budgetUsd=" + budget + "; preferredArea=" + area + "; timelineDays=" + timeline + ". Return the four requested fields.",
    expected,
    grade: (output) => {
      const x = record(output);
      const valid = !!x && typeof x.isQualified === "boolean" && typeof x.budgetUsd === "number" &&
        typeof x.preferredArea === "string" && Number.isInteger(x.timelineDays);
      return { schemaValid: valid, taskCorrect: valid && x.isQualified === qualified &&
        x.budgetUsd === budget && x.preferredArea === area && x.timelineDays === timeline };
    },
  };
});

const extractions: AIQualityCase[] = Array.from({ length: 20 }, (_, i) => {
  const email = "buyer" + (i + 1) + "@example.test";
  const phone = "+234800000" + String(100 + i);
  const budget = 210_000 + i * 19_750;
  const area = ["Lekki", "Yaba", "Ikeja", "Ajah", "Ikoyi"][i % 5];
  const moveInDays = 14 + (i * 11) % 180;
  const expected = { email, phone, budgetUsd: budget, preferredArea: area, moveInDays };
  return {
    id: "extract-" + (i + 1), task: "data_extraction", mode: "structured",
    systemPrompt: "Extract only the requested fields from the enquiry. Preserve exact values, return JSON, and do not infer missing values.",
    prompt: "Extract email, phone, budgetUsd, preferredArea, and moveInDays. Enquiry: " +
      email + "; phone " + phone + "; budgetUsd " + budget + "; area " + area + "; move-in " + moveInDays + " days.",
    expected,
    grade: (output) => {
      const x = record(output);
      const valid = !!x && typeof x.email === "string" && typeof x.phone === "string" &&
        typeof x.budgetUsd === "number" && typeof x.preferredArea === "string" && Number.isInteger(x.moveInDays);
      return { schemaValid: valid, taskCorrect: valid &&
        Object.entries(expected).every(([key, value]) => x[key] === value) };
    },
  };
});

const graphSystem = "Return only JSON shaped {registrySteps:[{id,nodeId,operationId,kind,input}],edges:[{id,source,target,label}]}. Make a connected acyclic graph with exactly one trigger, valid unique step IDs, and edges that reference existing steps. Do not add explanations or extra top-level fields.";
const graphCases: AIQualityCase[] = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const area = ["Lekki", "Yaba", "Ikeja", "Ajah", "Ikoyi"][i % 5];
  const recipient = "ops+" + n + "@example.test";
  const expected = {
    registrySteps: [
      { id: "trigger-" + n, nodeId: "webhook", operationId: "receive_event", kind: "trigger", input: {} },
      { id: "notify-" + n, nodeId: "email", operationId: "send_email", kind: "action",
        input: { to: recipient, subject: "New property enquiry", body: "Review the new " + area + " lead " + n + "." } },
    ],
    edges: [{ id: "edge-" + n, source: "trigger-" + n, target: "notify-" + n, label: "next" }],
  };
  return {
    id: "workflow-generation-" + n, task: "workflow_generation", mode: "structured",
    systemPrompt: graphSystem,
    prompt: "Create a minimal two-step workflow draft for property enquiry " + n + " in " + area +
      ". Use a webhook trigger with nodeId webhook and operationId receive_event, followed by an email action with nodeId email and operationId send_email. Send to " +
      recipient + " with subject New property enquiry and body Review the new " + area + " lead " + n +
      ". Use the exact step IDs trigger-" + n + " and notify-" + n + " and connect the trigger to the email step with one next edge. Inputs must match those facts.",
    expected,
    grade: (output) => {
      const x = record(output);
      const steps = Array.isArray(x?.registrySteps) ? x.registrySteps.map(record) : [];
      const edges = Array.isArray(x?.edges) ? x.edges.map(record) : [];
      const ids = steps.map((s) => s?.id);
      const unique = ids.length >= 2 && ids.every((id) => typeof id === "string") && new Set(ids).size === ids.length;
      const oneTrigger = steps.filter((s) => s?.kind === "trigger").length === 1;
      const fieldsValid = steps.every((s) => !!s && typeof s.nodeId === "string" &&
        typeof s.operationId === "string" && (s.kind === "trigger" || s.kind === "action") &&
        !!record(s.input));
      const edgeValid = edges.length >= 1 && edges.every((e) => !!e && ids.includes(e.source) && ids.includes(e.target));
      const triggerId = steps.find((s) => s?.kind === "trigger")?.id;
      const reachable = new Set<unknown>([triggerId]);
      for (let pass = 0; pass < steps.length; pass += 1) {
        for (const edge of edges) if (reachable.has(edge?.source)) reachable.add(edge?.target);
      }
      const allReachable = steps.every((step) => reachable.has(step?.id));
      const visited = new Set<unknown>();
      const active = new Set<unknown>();
      const hasCycle = (id: unknown): boolean => {
        if (active.has(id)) return true;
        if (visited.has(id)) return false;
        visited.add(id);
        active.add(id);
        for (const edge of edges) {
          if (edge?.source === id && hasCycle(edge.target)) return true;
        }
        active.delete(id);
        return false;
      };
      const cyclic = steps.some((step) => hasCycle(step?.id));
      const connected = edgeValid && typeof triggerId === "string" && allReachable && !cyclic;
      const action = steps.find((s) => s?.id === "notify-" + n);
      const actionInput = record(action?.input);
      const exactAction = action?.nodeId === "email" && action?.operationId === "send_email" &&
        actionInput?.to === recipient && actionInput?.subject === "New property enquiry";
      const edge = edges.some((e) => e?.source === "trigger-" + n && e?.target === "notify-" + n);
      const valid = !!x && Object.keys(x).every((key) => key === "registrySteps" || key === "edges") &&
        Array.isArray(x.registrySteps) && Array.isArray(x.edges) && unique && oneTrigger && fieldsValid && edgeValid && connected;
      return { schemaValid: valid, taskCorrect: valid && exactAction && edge,
        workflowGraphCorrectness: valid && exactAction && edge };
    },
  };
});

const repairCases: AIQualityCase[] = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const recipient = "repair+" + n + "@example.test";
  const subject = "Review property enquiry " + n;
  const body = "Please review lead " + n + " before contacting the buyer.";
  const expected = { repairs: [{ id: "send-" + n, input: { to: recipient, subject, body } }] };
  return {
    id: "schema-repair-" + n, task: "workflow_schema_repair", mode: "structured",
    systemPrompt: "Repair only the supplied operation input. Return JSON shaped exactly {repairs:[{id,input}]}. Keep the step ID unchanged, use the supplied approved recipient, and return valid non-empty to, subject, and body strings. Do not invent facts.",
    prompt: "Repair this invalid registered email action input. Step ID: send-" + n +
      ". Approved recipient: " + recipient + ". Required subject: " + subject + ". Required body: " + body +
      ". Current input: {to:\"\",subject:null,body:\"\"}. Return exactly one repair for this step.",
    expected,
    grade: (output) => {
      const x = record(output);
      const repairs = Array.isArray(x?.repairs) ? x.repairs.map(record) : [];
      const input = record(repairs[0]?.input);
      const valid = !!x && Object.keys(x).length === 1 && repairs.length === 1 &&
        repairs[0]?.id === "send-" + n && !!input && typeof input.to === "string" &&
        typeof input.subject === "string" && typeof input.body === "string";
      const correct = valid && input.to === recipient && input.subject === subject && input.body === body;
      return { schemaValid: valid, taskCorrect: correct };
    },
  };
});

const debugScenarios = [
  ["duplicate webhook deliveries created duplicate CRM contacts", "missing idempotency key", "persist an idempotency key before create"],
  ["the email action ran before the lead qualification step", "incorrect edge order", "connect qualification before email"],
  ["the workflow stopped because a required email field was null", "missing required field mapping", "validate and map the email field"],
  ["the conditional branch sent unqualified leads to the sales team", "inverted condition", "reverse the true and false branch labels"],
  ["a retry created a second payment request", "non-idempotent retry", "use an idempotency key for the write"],
  ["the webhook returned 401 after credential rotation", "stale credential", "refresh the connected credential"],
  ["the workflow executed an action twice after a timeout", "unknown action outcome", "check the operation ledger before retry"],
  ["the CRM search returned several contacts and create ran anyway", "ambiguous search result", "require a unique match before create"],
  ["a scheduled follow-up ran in the wrong timezone", "timezone conversion error", "store and compare UTC timestamps"],
  ["the email action received a phone number in its recipient field", "incorrect field mapping", "map the buyer email output"],
  ["the workflow looped between two condition nodes", "cyclic graph", "remove the back edge and keep the graph acyclic"],
  ["the AI node returned text but the next node expected JSON", "structured output contract mismatch", "validate JSON against the output schema"],
  ["the workflow could not resume after a worker restart", "in-memory execution state", "persist the checkpoint before yielding"],
  ["the approval action was skipped after a duplicate event", "deduplication scope collision", "scope the idempotency key by tenant and operation"],
  ["the retry worker sent a message after consent was withdrawn", "consent not rechecked", "recheck consent immediately before dispatch"],
  ["the CRM create step ran without a successful search", "missing dependency edge", "connect search success to create"],
  ["the notification used an old property price", "stale cached data", "refresh the source record before drafting"],
  ["the HTTP action followed a redirect to a private network address", "unsafe redirect destination", "revalidate every redirect target"],
  ["the workflow completed while one branch was still pending", "premature join", "wait for all required branches before completion"],
  ["the event processor marked a failed notification as delivered", "incorrect success acknowledgement", "acknowledge only after provider acceptance"],
] as const;
const debugCases: AIQualityCase[] = debugScenarios.map(([symptom, cause, fix], i) => ({
  id: "debug-" + (i + 1), task: "workflow_debugging", mode: "structured",
  systemPrompt: "Diagnose the workflow incident. Return only JSON with string fields rootCause, fix, and verification. Distinguish the observed symptom from the root cause and give a concrete corrective action.",
  prompt: "Incident: " + symptom + ". Diagnose the root cause and propose a specific fix and a verification step.",
  expected: { rootCause: cause, fix, verification: "replay the affected workflow and verify the corrected behavior" },
  grade: (output) => {
    const x = record(output);
    const valid = !!x && typeof x.rootCause === "string" && typeof x.fix === "string" &&
      typeof x.verification === "string";
    return { schemaValid: valid, taskCorrect: valid &&
      hasAll(x.rootCause, [cause]) && hasAll(x.fix, [fix.split(" ")[0]]) &&
      hasAll(x.verification, ["verify", "workflow"]) };
  },
}));

const emailCases: AIQualityCase[] = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const name = ["Amina", "Chidi", "Tolu", "Zainab", "Emeka"][i % 5];
  const area = ["Lekki", "Yaba", "Ikeja", "Ajah", "Ikoyi"][i % 5];
  const property = "two-bedroom apartment " + n;
  const expected = "Hello " + name + ", thank you for your interest in the " + property +
    " in " + area + ". I can arrange a viewing this week. Please reply with a suitable time.";
  const required = [name.toLowerCase(), property, area.toLowerCase(), "viewing", "reply", "suitable time"];
  return {
    id: "email-" + n, task: "email_drafting", mode: "text",
    systemPrompt: "Draft a concise, professional email. Include every supplied fact, do not invent availability or pricing, and include a clear reply-based call to action.",
    prompt: "Write an email to " + name + " about the " + property + " in " + area +
      ". Say a viewing can be arranged this week and ask the recipient to reply with a suitable time. Do not add a price.",
    expected, grade: (output) => ({ schemaValid: null, taskCorrect: hasAll(output, required) }),
  };
});

const summaries: AIQualityCase[] = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const name = ["Amina", "Chidi", "Tolu", "Zainab", "Emeka"][i % 5];
  const area = ["Lekki", "Yaba", "Ikeja", "Ajah", "Ikoyi"][i % 5];
  const budget = 250_000 + n * 12_500;
  const timeline = 10 + n * 3;
  const source = "Lead " + n + ": " + name + " wants a property in " + area +
    ". Budget is USD " + budget + ". Move-in timeline is " + timeline +
    " days. Contact status is not yet verified. No viewing has been booked.";
  const expected = "Lead " + n + " " + name + " " + area + " USD " + budget +
    " " + timeline + " days not verified no viewing booked";
  return {
    id: "summary-" + n, task: "summarization", mode: "text",
    systemPrompt: "Summarize the supplied lead record in one or two sentences. Preserve the exact ID, name, area, budget, timeline, and status. Never imply an unverified contact or unbooked viewing is complete.",
    prompt: "Summarize this record without adding facts: " + source,
    expected, grade: (output) => ({ schemaValid: null, taskCorrect: hasAll(output,
      ["lead " + n, name, area, "usd " + budget, timeline + " days", "not verified", "no viewing booked"]) }),
  };
});

const toolCases: AIQualityCase[] = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const leadId = "lead_" + String(n).padStart(3, "0");
  const owner = ["sales-east", "sales-west", "agency-admin"][i % 3];
  const priority = i % 4 === 0 ? "high" : "normal";
  const tools: AIToolDefinition[] = [{
    name: "create_approval_request",
    description: "Create an approval request for a lead. Do not execute the underlying external action.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        leadId: { type: "string" }, owner: { type: "string", enum: ["sales-east", "sales-west", "agency-admin"] },
        priority: { type: "string", enum: ["normal", "high"] },
      },
      required: ["leadId", "owner", "priority"],
    },
  }];
  const expected = { text: "", toolCalls: [{ id: "call-" + n, name: "create_approval_request",
    arguments: { leadId, owner, priority } }] } satisfies AIToolOutput;
  return {
    id: "tool-" + n, task: "agent_tool_calling", mode: "tools", tools,
    systemPrompt: "Use the create_approval_request tool exactly once with the supplied leadId, owner, and priority. Do not invent arguments and do not claim that an external action was executed.",
    prompt: "Create an approval request for lead " + leadId + ". Assign it to " + owner +
      " with " + priority + " priority. Call the tool now; do not just describe the action.",
    expected,
    grade: (output) => {
      const x = record(output);
      const calls = Array.isArray(x?.toolCalls) ? x.toolCalls.map(record) : [];
      const args = record(calls[0]?.arguments);
      const valid = !!x && Array.isArray(x.toolCalls) && calls.length === 1 &&
        calls[0]?.name === "create_approval_request" && !!args;
      const correct = valid && args.leadId === leadId && args.owner === owner && args.priority === priority;
      return { schemaValid: valid, taskCorrect: correct, toolCallAccuracy: correct };
    },
  };
});

export const AI_QUALITY_BENCHMARK_CASES: AIQualityCase[] = [
  ...graphCases, ...repairCases, ...debugCases, ...leads, ...emailCases, ...extractions, ...summaries, ...toolCases,
];

export const AI_QUALITY_TASKS: AITask[] = [
  "workflow_generation", "workflow_schema_repair", "workflow_debugging", "lead_qualification",
  "email_drafting", "data_extraction", "summarization", "agent_tool_calling",
];

export function getAIQualityCases(task: AITask): AIQualityCase[] {
  return AI_QUALITY_BENCHMARK_CASES.filter((benchmarkCase) => benchmarkCase.task === task);
}
