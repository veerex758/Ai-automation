import type { RegisteredWorkflowStep } from "../../nodes/workflow-runner";

type BuilderNode = {
  id: string; type: "trigger" | "action" | "condition"; title: string;
  settings: Record<string, string | undefined>; registryNodeId?: string; registryOperationId?: string;
  registryInput?: Record<string, unknown>;
};
type BuilderEdge = { id: string; source: string; target: string; label: "true" | "false" | "next" };
type BuilderDefinition = { nodes: BuilderNode[]; edges?: BuilderEdge[] };

const conditionOperators: Record<string, string> = {
  equals: "equals", not_equals: "not_equals", contains: "contains",
  greater_than: "greater_than", less_than: "less_than", is_set: "exists", is_empty: "is_empty",
};

function actionFor(node: BuilderNode) {
  const provider = node.settings.provider ?? "internal";
  const nodeId = node.registryNodeId ?? (provider === "email" ? "email" : provider === "slack" ? "slack" : provider === "openai" ? "openai" : provider === "gemini" ? "gemini" : "slack");
  const operationId = node.registryOperationId ?? (provider === "email" ? "send_email" : provider === "slack" ? "send_message" : provider === "openai" || provider === "gemini" ? "generate_text" : "send_message");
  const input = node.registryInput ?? (provider === "email"
    ? { to: node.settings.recipient ?? "", subject: node.title, text: node.settings.message ?? node.title }
    : provider === "slack" ? { message: node.settings.message ?? node.title }
    : provider === "openai" || provider === "gemini" ? { prompt: node.settings.message ?? node.title }
    : { message: node.settings.message ?? node.title });
  return { nodeId, operationId, input };
}

/** Converts the editable canvas graph into a topologically ordered executable plan. */
export function buildRegistrySteps(definition: BuilderDefinition): RegisteredWorkflowStep[] {
  const nodes = definition.nodes;
  const edges = definition.edges ?? [];
  if (!nodes.length) throw new Error("A workflow needs a trigger.");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const orderIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as BuilderEdge[]]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) throw new Error("A workflow connection references a missing step.");
    outgoing.get(edge.source)!.push(edge);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const ready = nodes.filter((node) => indegree.get(node.id) === 0).sort((a, b) => orderIndex.get(a.id)! - orderIndex.get(b.id)!);
  const ordered: BuilderNode[] = [];
  while (ready.length) {
    const current = ready.shift()!;
    ordered.push(current);
    for (const edge of outgoing.get(current.id)!) {
      const next = indegree.get(edge.target)! - 1;
      indegree.set(edge.target, next);
      if (next === 0) {
        ready.push(byId.get(edge.target)!);
        ready.sort((a, b) => orderIndex.get(a.id)! - orderIndex.get(b.id)!);
      }
    }
  }
  if (ordered.length !== nodes.length) throw new Error("Workflow connections cannot contain a cycle.");
  const trigger = ordered[0];
  if (trigger.type !== "trigger") throw new Error("The workflow must start with a trigger.");

  const pathsByNode = new Map<string, Array<Array<{ fromStepId: string; route: string }>>>();
  pathsByNode.set(trigger.id, [[]]);
  for (const node of ordered) {
    const paths = pathsByNode.get(node.id) ?? [[]];
    for (const edge of outgoing.get(node.id)!) {
      const nextPaths = paths.map((path) => edge.label === "next" ? path : [...path, { fromStepId: node.id, route: edge.label }]);
      const current = pathsByNode.get(edge.target) ?? [];
      for (const path of nextPaths) {
        const key = JSON.stringify(path);
        if (!current.some((existing) => JSON.stringify(existing) === key)) current.push(path);
      }
      if (current.length > 200) throw new Error("Workflow has too many distinct branch paths.");
      pathsByNode.set(edge.target, current);
    }
  }

  return ordered.map((node): RegisteredWorkflowStep => {
    let nodeId: string, operationId: string, kind: "trigger" | "action", input: unknown;
    if (node.type === "trigger") {
      nodeId = node.registryNodeId ?? "manual";
      operationId = node.registryOperationId ?? "start";
      kind = "trigger";
      input = node.registryInput ?? {};
    } else if (node.type === "condition") {
      const field = node.settings.field?.trim() ?? "";
      if (!field) throw new Error("Configure the field for condition: " + node.title);
      const reference = field.startsWith("{{") && field.endsWith("}}") ? field : "{{" + trigger.id + ".payload." + field + "}}";
      if (!/^\{\{[a-zA-Z0-9_-]{1,64}(?:\.[a-zA-Z0-9_-]{1,64})+\}\}$/.test(reference)) throw new Error("Use a valid field path or step expression for condition: " + node.title);
      const operator = conditionOperators[node.settings.operator ?? "equals"] ?? "equals";
      const rawValue = node.settings.value ?? "";
      const compareTo = ["greater_than", "less_than"].includes(operator) && rawValue.trim() !== "" && Number.isFinite(Number(rawValue)) ? Number(rawValue) : rawValue;
      nodeId = "if"; operationId = "evaluate"; kind = "action";
      input = { value: reference, operator, ...(operator === "exists" || operator === "is_empty" ? {} : { compareTo }) };
    } else {
      const action = actionFor(node);
      nodeId = action.nodeId; operationId = action.operationId; kind = "action"; input = action.input;
    }
    const paths = pathsByNode.get(node.id) ?? [];
    const branchPaths = paths.some((path) => path.length === 0) ? undefined : paths;
    return { id: node.id, nodeId, operationId, kind, input, ...(branchPaths?.length ? { branchPaths } : {}) };
  });
}
