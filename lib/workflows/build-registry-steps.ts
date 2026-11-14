import type { RegisteredWorkflowStep } from "../../nodes/workflow-runner";

type BuilderNode = {
  id: string; type: "trigger" | "action" | "condition"; title: string;
  settings: Record<string, string | undefined>; registryNodeId?: string; registryOperationId?: string;
  registryInput?: Record<string, unknown>;
};
type BuilderEdge = { id: string; source: string; target: string; label: "true" | "false" | "next" };
type BuilderDefinition = { nodes: BuilderNode[]; edges?: BuilderEdge[] };

const conditionOperators: Record<string, string> = {
  equals: "equals", contains: "contains", greater_than: "greater_than", less_than: "less_than", is_set: "exists",
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
  if (nodes.length > 30 || edges.length > 90) throw new Error("Workflow graph exceeds the supported node or connection limit.");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length || nodes.some((node) => !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id))) {
    throw new Error("Workflow step IDs must be unique and valid.");
  }
  if (nodes.filter((node) => node.type === "trigger").length !== 1) throw new Error("A workflow must contain exactly one trigger.");
  const orderIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as BuilderEdge[]]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const edgeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    if (!edge || typeof edge.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(edge.id) || edgeIds.has(edge.id)) {
      throw new Error("Workflow connection IDs must be unique and valid.");
    }
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target) {
      throw new Error("A workflow connection references an invalid step.");
    }
    if (!["next", "true", "false"].includes(edge.label)) throw new Error("Choose a valid workflow connection type.");
    if (byId.get(edge.target)?.type === "trigger") throw new Error("A workflow connection cannot point into the trigger.");
    if (edge.label !== "next") {
      const source = byId.get(edge.source)!;
      const isSwitch = source.type === "action" && source.registryNodeId === "switch" && source.registryOperationId === "select_route";
      if (source.type !== "condition" && !isSwitch) throw new Error("Only IF and Switch nodes can create true/false connections.");
    }
    const edgeKey = edge.source + ":" + edge.target + ":" + edge.label;
    if (edgeKeys.has(edgeKey)) throw new Error("Duplicate workflow connections are not allowed.");
    edgeIds.add(edge.id);
    edgeKeys.add(edgeKey);
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
  if ((indegree.get(trigger.id) ?? 0) !== 0) throw new Error("The workflow trigger cannot have incoming connections.");

  const reachable = new Set<string>([trigger.id]);
  for (const node of ordered) {
    if (!reachable.has(node.id)) continue;
    for (const edge of outgoing.get(node.id)!) reachable.add(edge.target);
  }
  if (reachable.size !== nodes.length) throw new Error("Every workflow node must be reachable from the trigger.");

  for (const node of nodes) {
    const nodeEdges = outgoing.get(node.id) ?? [];
    if (nodeEdges.length && (node.type === "condition" || (node.type === "action" && node.registryNodeId === "switch" && node.registryOperationId === "select_route"))) {
      if (!nodeEdges.some((edge) => edge.label === "true") || !nodeEdges.some((edge) => edge.label === "false")) {
        throw new Error("Every IF or Switch node with downstream work needs true and false paths.");
      }
    }
  }

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
      if (current.length > 60) throw new Error("Workflow has too many distinct branch paths.");
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
      const reference = field.startsWith("{{") && field.endsWith("}}") ? field : field.startsWith(trigger.id + ".") ? "{{" + field + "}}" : "{{" + trigger.id + "." + (field.startsWith("payload.") ? field : "payload." + field) + "}}";
      if (!/^\{\{[a-zA-Z0-9_-]{1,64}(?:\.[a-zA-Z0-9_-]{1,64})+\}\}$/.test(reference)) throw new Error("Use a valid field path or step expression for condition: " + node.title);
      const rawOperator = node.settings.operator ?? "equals";
      const operator = conditionOperators[rawOperator];
      if (!operator) throw new Error("Choose a supported condition operator for: " + node.title);
      const rawValue = node.settings.value ?? "";
      const compareTo = ["greater_than", "less_than"].includes(operator) && rawValue.trim() !== "" && Number.isFinite(Number(rawValue)) ? Number(rawValue) : rawValue;
      nodeId = "if"; operationId = "evaluate"; kind = "action";
      input = { value: reference, operator, ...(operator === "exists" ? {} : { compareTo }) };
    } else {
      const action = actionFor(node);
      nodeId = action.nodeId; operationId = action.operationId; kind = "action"; input = action.input;
    }
    const paths = pathsByNode.get(node.id) ?? [];
    const branchPaths = paths.some((path) => path.length === 0) ? undefined : paths;
    return { id: node.id, nodeId, operationId, kind, input, ...(branchPaths?.length ? { branchPaths } : {}) };
  });
}
