import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRegisteredWorkflow } from "../nodes/workflow-runner";

const context = {
  credentials: { openai: { apiKey: "test-only-key" } },
  logger: { info() {}, error() {} },
  http: { async request() { return { status: 200, body: { output_text: "Generated text", model: "gpt-4o-mini" } }; } },
};


test("registry runner awaits durable start and completion checkpoints around each action", async () => {
  const events: string[] = [];
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } }],
    context,
    dryRun: false,
    async onStepStart(step, position) { events.push(`start:${position}:${step.id}`); },
    async onStepComplete(step, position, completed) {
      events.push(`complete:${position}:${step.id}:${completed.status}`);
    },
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(events, ["start:1:draft", "complete:1:draft:succeeded"]);
});

test("registry runner does not call a provider when its start checkpoint fails", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } }],
    context: { ...context, http: { async request() { calls++; return { status: 200, body: { output_text: "should not execute" } }; } } },
    dryRun: false,
    async onStepStart() { throw new Error("CHECKPOINT_WRITE_FAILED"); },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.steps[0].error, "CHECKPOINT_WRITE_FAILED");
  assert.equal(calls, 0);
});

test("registry workflow dry-run validates registered steps without calling providers", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } }],
    context: { ...context, http: { async request() { calls++; return { status: 200, body: {} }; } } },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps[0].status, "simulated");
  assert.equal(calls, 0);
});

test("registry workflow stores validated operation outputs for later steps", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } }],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps[0].status, "succeeded");
  assert.equal((result.outputs.draft as { text: string }).text, "Generated text");
});

test("registry workflow stops after a failed registered operation", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "bad", nodeId: "unknown", operationId: "missing", kind: "action", input: {} },
      { id: "later", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Should not run" } },
    ],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.steps[0].error, "NODE_OPERATION_NOT_FOUND");
  assert.equal(result.steps[1].status, "skipped");
});

test("registry workflow dry-run accepts previous-step references without provider calls", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Draft a message" } },
      { id: "rewrite", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Rewrite this: {{draft.text}}" } },
    ],
    context: { ...context, http: { async request() { calls++; return { status: 200, body: {} }; } } },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].status, "simulated");
  assert.equal(calls, 0);
});

test("OpenAI output can feed Slack and Email in one registry workflow", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "draft", nodeId: "openai", operationId: "generate_text", kind: "action", input: { prompt: "Write a concise appointment reminder" } },
      { id: "slackNotice", nodeId: "slack", operationId: "send_message", kind: "action", input: { message: "Reminder draft: {{draft.text}}" } },
      { id: "emailNotice", nodeId: "email", operationId: "send_email", kind: "action", input: { to: "recipient@example.com", subject: "Appointment reminder", text: "{{draft.text}}" } },
    ],
    context: {
      credentials: {
        openai: { apiKey: "test-only-key" },
        slack: { webhookUrl: "https://hooks.slack.com/services/T000/B000/secret" },
        resend: { apiKey: "test-only-key", fromEmail: "test@example.com" },
      },
      logger: { info() {}, error() {} },
      http: { async request(args) {
        requests.push({ url: args.url, body: args.body });
        if (args.url === "https://api.openai.com/v1/responses") return { status: 200, body: { output_text: "Your appointment is tomorrow at 10 AM.", model: "gpt-4o-mini", usage: { input_tokens: 10, output_tokens: 8 } } };
        if (args.url === "https://api.resend.com/emails") return { status: 200, body: { id: "email_test_123" } };
        return { status: 200, body: "ok" };
      } },
    },
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["succeeded", "succeeded", "succeeded"]);
  assert.equal(requests.length, 3);
  assert.equal((requests[1].body as { text: string }).text, "Reminder draft: Your appointment is tomorrow at 10 AM.");
  assert.equal((requests[2].body as { text: string }).text, "Your appointment is tomorrow at 10 AM.");
});

test("registry dry-run simulates Slack and Email without calling their providers", async () => {
  let calls = 0;
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "slackNotice", nodeId: "slack", operationId: "send_message", kind: "action", input: { message: "Hello" } },
      { id: "emailNotice", nodeId: "email", operationId: "send_email", kind: "action", input: { to: "recipient@example.com", subject: "Hello", text: "Hello" } },
    ],
    context: {
      credentials: { slack: { webhookUrl: "https://hooks.slack.com/services/T000/B000/secret" }, resend: { apiKey: "test-only-key", fromEmail: "test@example.com" } },
      logger: { info() {}, error() {} },
      http: { async request() { calls++; return { status: 200, body: {} }; } },
    },
    dryRun: true,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["simulated", "simulated"]);
  assert.equal(calls, 0);
});

test("registry workflow validates and executes explicit branch selection", async () => {
  const { validateRegisteredSteps } = await import("../nodes/validate-steps");
  const raw = [
    { id: "manual", nodeId: "manual", operationId: "start", kind: "trigger", input: {} },
    { id: "condition", nodeId: "if", operationId: "evaluate", kind: "action", input: { value: "approved", operator: "equals", compareTo: "approved" } },
    { id: "yes", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { route: "approved" } }, branch: { fromStepId: "condition", route: "true" } },
    { id: "no", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { route: "rejected" } }, branch: { fromStepId: "condition", route: "false" } },
  ];
  const validated = validateRegisteredSteps(raw);
  assert.ok(validated.steps);
  const result = await executeRegisteredWorkflow({ steps: validated.steps, context, dryRun: false });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["succeeded", "succeeded", "succeeded", "skipped"]);
  assert.equal(validateRegisteredSteps([raw[0], { ...raw[2], branch: { fromStepId: "later", route: "true" } }]).error, "Branch source must be an earlier IF or Switch step.");
});


test("loop metadata executes a downstream registered operation once per source item", async () => {
  const calls: string[] = [];
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "manual", nodeId: "manual", operationId: "start", kind: "trigger", input: {} },
      { id: "items", nodeId: "loop", operationId: "iterate", kind: "action", input: { items: ["alpha", "beta", "gamma"] } },
      { id: "each", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { value: "{{loop_item}}", index: "{{loop_index}}" } }, loop: { sourceStepId: "items", maxIterations: 10 } },
    ],
    context: { ...context, http: { async request() { calls.push("request"); return { status: 200, body: {} }; } } },
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.outputs.each, [
    { data: { value: "alpha", index: 0 } },
    { data: { value: "beta", index: 1 } },
    { data: { value: "gamma", index: 2 } },
  ]);
});


test("loop metadata executes multiple downstream steps per source item", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "manual", nodeId: "manual", operationId: "start", kind: "trigger", input: {} },
      { id: "items", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { items: ["alpha", "beta", "gamma"] } } },
      { id: "each", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { value: "{{loop_item}}", index: "{{loop_index}}" } }, loop: { sourceStepId: "items", maxIterations: 10 } },
      { id: "decorate", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { label: "item-{{each.data.value}}", index: "{{each.data.index}}" } }, loop: { sourceStepId: "items", maxIterations: 10 } },
    ],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.outputs.decorate, [
    { data: { label: "item-alpha", index: 0 } },
    { data: { label: "item-beta", index: 1 } },
    { data: { label: "item-gamma", index: 2 } },
  ]);
});


test("Wait pauses the runner and resumes after its persisted checkpoint", async () => {
  const steps = [
    { id: "manual", nodeId: "manual", operationId: "start", kind: "trigger" as const, input: {} },
    { id: "delay", nodeId: "wait", operationId: "delay", kind: "action" as const, input: { durationMs: 1000 } },
    { id: "after", nodeId: "set_fields", operationId: "merge_fields", kind: "action" as const, input: { data: {}, fields: { resumedAt: "{{delay.resumeAt}}" } } },
  ];
  const checkpointOutputs: Record<string, unknown> = {};
  const first = await executeRegisteredWorkflow({
    steps, context, dryRun: false,
    async onStepComplete(step, _position, completed) {
      if (completed.status === "succeeded") checkpointOutputs[step.id] = completed.output;
    },
  });
  assert.equal(first.status, "waiting");
  assert.ok(typeof first.resumeAt === "string");
  assert.equal(first.steps.some((step) => step.stepId === "after"), false);
  const resumed = await executeRegisteredWorkflow({
    steps, context, dryRun: false,
    initialOutputs: checkpointOutputs,
    completedStepIds: ["manual", "delay"],
  });
  assert.equal(resumed.status, "succeeded");
  assert.equal((resumed.outputs.after as { data: { resumedAt: string } }).data.resumedAt, checkpointOutputs.delay && (checkpointOutputs.delay as { resumeAt: string }).resumeAt);
});


test("Schedule/Cron trigger passes its persisted event context to downstream steps", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "schedule", nodeId: "schedule", operationId: "scheduled", kind: "trigger", input: {
        scheduledAt: "2026-11-04T09:15:00.000Z", timezone: "Africa/Lagos", cronExpression: "15 10 * * *",
      } },
      { id: "capture", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: {
        data: {}, fields: { startedAt: "{{schedule.scheduledAt}}", timezone: "{{schedule.timezone}}" },
      } },
    ],
    context,
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.outputs.capture, { data: { startedAt: "2026-11-04T09:15:00.000Z", timezone: "Africa/Lagos" } });
});


test("Split in Batches drives each downstream step once per batch in order",async()=>{
 const result=await executeRegisteredWorkflow({
  steps:[
   {id:"source",nodeId:"split_batches",operationId:"split",kind:"action",input:{items:[1,2,3,4,5],batchSize:2}},
   {id:"process",nodeId:"array_ops",operationId:"operate",kind:"action",input:{items:"{{batch}}",operation:"flatten"},loop:{sourceStepId:"source",itemAs:"batch",indexAs:"batch_index",maxIterations:10}},
  ],
  context,dryRun:false,
 });
 assert.equal(result.status,"succeeded");
 assert.deepEqual(result.outputs.process,[{items:[1,2],count:2},{items:[3,4],count:2},{items:[5],count:1}]);
});

test("Split in Batches supports chained downstream batch steps with matching batch scope",async()=>{
 const result=await executeRegisteredWorkflow({
  steps:[
   {id:"source",nodeId:"split_batches",operationId:"split",kind:"action",input:{items:[1,2,3,4],batchSize:2}},
   {id:"first",nodeId:"array_ops",operationId:"operate",kind:"action",input:{items:"{{batch}}",operation:"reverse"},loop:{sourceStepId:"source",itemAs:"batch",indexAs:"batch_index",maxIterations:10}},
   {id:"second",nodeId:"array_ops",operationId:"operate",kind:"action",input:{items:"{{first.items}}",operation:"flatten"},loop:{sourceStepId:"source",itemAs:"batch",indexAs:"batch_index",maxIterations:10}},
  ],
  context,dryRun:false,
 });
 assert.equal(result.status,"succeeded");
 assert.deepEqual(result.outputs.first,[{items:[2,1],count:2},{items:[4,3],count:2}]);
 assert.deepEqual(result.outputs.second,[{items:[2,1],count:2},{items:[4,3],count:2}]);
});

test("workflow runner emits a normalized error event once when an operation fails",async()=>{
 const events:Array<{code:string;stepId:string}>=[];
 const result=await executeRegisteredWorkflow({
  steps:[{id:"bad",nodeId:"math",operationId:"calculate",kind:"action",input:{a:1,b:0,operation:"div"}}],
  context,dryRun:false,
  async onWorkflowError(event){events.push(event)},
 });
 assert.equal(result.status,"failed");
 assert.deepEqual(events,[{code:"MATH_INVALID_RESULT",message:"MATH_INVALID_RESULT",stepId:"bad"}]);
});

test("workflow error reporter cannot mask the original failed step",async()=>{
 const result=await executeRegisteredWorkflow({
  steps:[{id:"bad",nodeId:"math",operationId:"calculate",kind:"action",input:{a:1,b:0,operation:"div"}}],
  context,dryRun:false,
  async onWorkflowError(){throw new Error("REPORTING_DOWN")},
 });
 assert.equal(result.status,"failed");
 assert.equal(result.steps[0].error,"MATH_INVALID_RESULT");
});


test("whole-value workflow references preserve arrays and objects instead of stringifying them", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "source", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { payload: [{ id: 1 }, { id: 2 }] } } },
      { id: "copy", nodeId: "array_ops", operationId: "operate", kind: "action", input: { items: "{{source.data.payload}}", operation: "reverse" } },
    ],
    context, dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.outputs.copy, { items: [{ id: 2 }, { id: 1 }], count: 2 });
});

test("Split in Batches passes each actual batch to downstream work, not the full batch list", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "source", nodeId: "split_batches", operationId: "split", kind: "action", input: { items: [1, 2, 3, 4, 5], batchSize: 2 } },
      { id: "consume", nodeId: "array_ops", operationId: "operate", kind: "action", input: { items: "{{current_batch}}", operation: "reverse" }, loop: { sourceStepId: "source", itemAs: "current_batch", indexAs: "batch_index", maxIterations: 10 } },
    ],
    context, dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.outputs.consume, [{items:[2,1],count:2},{items:[4,3],count:2},{items:[5],count:1}]);
});

test("workflow references reject prototype traversal", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "source", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: { value: "safe" } } },
      { id: "read", nodeId: "text_transform", operationId: "transform", kind: "action", input: { text: "{{source.__proto__}}", operation: "trim" } },
    ],
    context, dryRun: false,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.steps[1].error, "WORKFLOW_REFERENCE_NOT_FOUND");
});


test("Split in Batches resumes completed downstream iterations without replaying them", async () => {
  const result = await executeRegisteredWorkflow({
    steps: [
      { id: "source", nodeId: "split_batches", operationId: "split", kind: "action", input: { items: [1, 2, 3, 4], batchSize: 2 } },
      { id: "consume", nodeId: "array_ops", operationId: "operate", kind: "action", input: { items: "{{current_batch}}", operation: "reverse" }, loop: { sourceStepId: "source", itemAs: "current_batch", indexAs: "batch_index", maxIterations: 10 } },
    ],
    context,
    dryRun: false,
    initialOutputs: { "consume__loop_1": { items: ["persisted-result"], count: 1 } },
    completedStepIds: ["consume__loop_1"],
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.outputs.consume, [
    { items: ["persisted-result"], count: 1 },
    { items: [4, 3], count: 2 },
  ]);
});


test("Gemini qualifies real-estate enquiries with structured output and preserves missing facts", async () => {
  const lead = {
    fullName: "Ada Buyer", email: "ada@example.com", phone: null, propertyType: "apartment",
    location: "Lekki", budget: "₦80m", timeframe: "within_30_days", temperature: "hot",
    reason: "Specific property and near-term intent.", missingInformation: ["Phone number"],
    suggestedReply: "Thanks for your enquiry. May we have your phone number?",
    summary: "HOT lead: Ada Buyer wants an apartment in Lekki within 30 days; budget ₦80m.",
  };
  let requestBody: unknown;
  const result = await executeRegisteredWorkflow({
    steps: [{ id: "qualify", nodeId: "gemini", operationId: "qualify_real_estate_lead", kind: "action", input: { leadData: "Name: Ada Buyer; apartment in Lekki; budget ₦80m; within 30 days." } }],
    context: {
      credentials: { gemini: { apiKey: "test-only-key" } },
      logger: { info() {}, error() {} },
      http: { async request(args) {
        requestBody = args.body;
        return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(lead) }] } }], usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 55 } } };
      } },
    },
    dryRun: false,
  });
  assert.equal(result.status, "succeeded");
  assert.equal((result.outputs.qualify as { phone: string | null }).phone, null);
  assert.deepEqual((result.outputs.qualify as { missingInformation: string[] }).missingInformation, ["Phone number"]);
  assert.equal((result.outputs.qualify as { outputTokens: number }).outputTokens, 55);
  assert.ok((requestBody as { generationConfig: { responseJsonSchema: unknown } }).generationConfig.responseJsonSchema);
});


test("builder graph becomes a topologically ordered runtime plan with executable branches and convergence", async () => {
  const { buildRegistrySteps } = await import("../lib/workflows/build-registry-steps");
  const { validateRegisteredSteps } = await import("../nodes/validate-steps");
  const definition = {
    nodes: [
      { id: "trigger", type: "trigger" as const, title: "Webhook", settings: {}, registryNodeId: "webhooks", registryOperationId: "receive_event", registryInput: { eventId: "evt_1", eventType: "lead", receivedAt: new Date().toISOString(), payload: { score: 12 } } },
      { id: "yes", type: "action" as const, title: "Approved", settings: {}, registryNodeId: "set_fields", registryOperationId: "merge_fields", registryInput: { data: {}, fields: { outcome: "approved" } } },
      { id: "no", type: "action" as const, title: "Rejected", settings: {}, registryNodeId: "set_fields", registryOperationId: "merge_fields", registryInput: { data: {}, fields: { outcome: "rejected" } } },
      { id: "condition", type: "condition" as const, title: "Score check", settings: { field: "score", operator: "greater_than", value: "10" } },
      { id: "shared", type: "action" as const, title: "Notify", settings: {}, registryNodeId: "set_fields", registryOperationId: "merge_fields", registryInput: { data: {}, fields: { notified: true } } },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "condition", label: "next" as const },
      { id: "e2", source: "condition", target: "yes", label: "true" as const },
      { id: "e3", source: "condition", target: "no", label: "false" as const },
      { id: "e4", source: "yes", target: "shared", label: "next" as const },
      { id: "e5", source: "no", target: "shared", label: "next" as const },
    ],
  };
  const plan = buildRegistrySteps(definition);
  assert.deepEqual(plan.map((step) => step.id), ["trigger", "condition", "yes", "no", "shared"]);
  assert.equal(plan[1].nodeId, "if");
  assert.equal(plan[1].operationId, "evaluate");
  assert.deepEqual(plan.find((step) => step.id === "shared")?.branchPaths, [
    [{ fromStepId: "condition", route: "true" }],
    [{ fromStepId: "condition", route: "false" }],
  ]);
  const validated = validateRegisteredSteps(plan);
  assert.ok(validated.steps);
  const result = await executeRegisteredWorkflow({ steps: validated.steps!, context: { ...context, webhook: { verified: true } }, dryRun: false });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["succeeded", "succeeded", "succeeded", "skipped", "succeeded"]);
});

test("builder graph branch paths execute the false path and keep a converged node reachable", async () => {
  const { buildRegistrySteps } = await import("../lib/workflows/build-registry-steps");
  const { validateRegisteredSteps } = await import("../nodes/validate-steps");
  const definition = {
    nodes: [
      { id: "trigger", type: "trigger" as const, title: "Webhook", settings: {}, registryNodeId: "webhooks", registryOperationId: "receive_event", registryInput: { eventId: "evt_2", eventType: "lead", receivedAt: new Date().toISOString(), payload: { score: 4 } } },
      { id: "condition", type: "condition" as const, title: "Score check", settings: { field: "score", operator: "greater_than", value: "10" } },
      { id: "yes", type: "action" as const, title: "Approved", settings: {}, registryNodeId: "set_fields", registryOperationId: "merge_fields", registryInput: { data: {}, fields: { outcome: "approved" } } },
      { id: "no", type: "action" as const, title: "Rejected", settings: {}, registryNodeId: "set_fields", registryOperationId: "merge_fields", registryInput: { data: {}, fields: { outcome: "rejected" } } },
      { id: "shared", type: "action" as const, title: "Notify", settings: {}, registryNodeId: "set_fields", registryOperationId: "merge_fields", registryInput: { data: {}, fields: { notified: true } } },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "condition", label: "next" as const },
      { id: "e2", source: "condition", target: "yes", label: "true" as const },
      { id: "e3", source: "condition", target: "no", label: "false" as const },
      { id: "e4", source: "yes", target: "shared", label: "next" as const },
      { id: "e5", source: "no", target: "shared", label: "next" as const },
    ],
  };
  const validated = validateRegisteredSteps(buildRegistrySteps(definition));
  assert.ok(validated.steps);
  const result = await executeRegisteredWorkflow({ steps: validated.steps!, context: { ...context, webhook: { verified: true } }, dryRun: false });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["succeeded", "succeeded", "skipped", "succeeded", "succeeded"]);
});

test("registry branchPaths reject a predicate that references a later non-condition step", async () => {
  const { validateRegisteredSteps } = await import("../nodes/validate-steps");
  const invalid = validateRegisteredSteps([
    { id: "manual", nodeId: "manual", operationId: "start", kind: "trigger", input: {} },
    { id: "target", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: {} }, branchPaths: [[{ fromStepId: "later", route: "true" }]] },
    { id: "later", nodeId: "set_fields", operationId: "merge_fields", kind: "action", input: { data: {}, fields: {} } },
  ]);
  assert.equal(invalid.error, "Branch source must be an earlier IF or Switch step.");
});

test("IF existence conditions accept absent payload fields without failing reference resolution", async () => {
  const { buildRegistrySteps } = await import("../lib/workflows/build-registry-steps");
  const { validateRegisteredSteps } = await import("../nodes/validate-steps");
  const plan = buildRegistrySteps({
    nodes: [
      { id: "trigger", type: "trigger" as const, title: "Webhook", settings: {}, registryNodeId: "webhooks", registryOperationId: "receive_event", registryInput: { eventId: "evt_3", eventType: "lead", receivedAt: new Date().toISOString(), payload: {} } },
      { id: "condition", type: "condition" as const, title: "Phone provided", settings: { field: "phone", operator: "is_set" } },
      { id: "yes", type: "action" as const, title: "Has phone", settings: {}, registryNodeId: "set_fields", registryOperationId: "merge_fields", registryInput: { data: {}, fields: { result: "yes" } } },
      { id: "no", type: "action" as const, title: "Needs phone", settings: {}, registryNodeId: "set_fields", registryOperationId: "merge_fields", registryInput: { data: {}, fields: { result: "no" } } },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "condition", label: "next" as const },
      { id: "e2", source: "condition", target: "yes", label: "true" as const },
      { id: "e3", source: "condition", target: "no", label: "false" as const },
    ],
  });
  const validated = validateRegisteredSteps(plan);
  assert.ok(validated.steps);
  const result = await executeRegisteredWorkflow({ steps: validated.steps!, context: { ...context, webhook: { verified: true } }, dryRun: false });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.steps.map((step) => step.status), ["succeeded", "succeeded", "skipped", "succeeded"]);
});

test("Switch / Route executes only the selected branch and predicts it in dry-run", async () => {
  const steps = [
    { id: "routeLead", nodeId: "logic", operationId: "switch", kind: "action" as const,
      input: { value: "qualified", cases: [{ value: "new", route: "new_lead" }, { value: "qualified", route: "qualified_lead" }], defaultRoute: "review" } },
    { id: "newPath", nodeId: "data", operationId: "format_text", kind: "action" as const,
      input: { template: "new lead", data: {} }, branchPaths: [[{ fromStepId: "routeLead", route: "new_lead" }]] },
    { id: "qualifiedPath", nodeId: "data", operationId: "format_text", kind: "action" as const,
      input: { template: "qualified lead", data: {} }, branchPaths: [[{ fromStepId: "routeLead", route: "qualified_lead" }]] },
  ];
  const dry = await executeRegisteredWorkflow({ steps, context, dryRun: true });
  assert.equal(dry.status, "succeeded");
  assert.equal((dry.outputs.routeLead as { route: string }).route, "qualified_lead");
  assert.deepEqual(dry.steps.map(step => step.status), ["simulated", "skipped", "simulated"]);
  const live = await executeRegisteredWorkflow({ steps, context, dryRun: false });
  assert.equal(live.status, "succeeded");
  assert.deepEqual(live.steps.map(step => step.status), ["succeeded", "skipped", "succeeded"]);
  assert.equal((live.outputs.qualifiedPath as { text: string }).text, "qualified lead");
});
