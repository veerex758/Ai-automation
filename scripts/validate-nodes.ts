import { nodes } from "../nodes/registry";

const failures: string[] = [];
const nodeIds = new Set<string>();

for (const node of nodes) {
  if (!node.id || nodeIds.has(node.id)) failures.push("Node ID is missing or duplicated: " + node.id);
  nodeIds.add(node.id);
  if (!node.name || !node.icon || !node.category || !Number.isInteger(node.version) || node.version < 1) failures.push("Invalid node metadata: " + node.id);
  if (!node.auth || !["none", "oauth2", "apiKey", "connectionString"].includes(node.auth.type)) failures.push("Invalid auth config: " + node.id);
  const operationIds = new Set<string>();
  for (const operation of [...node.triggers, ...node.actions]) {
    if (!operation.id || operationIds.has(operation.id)) failures.push("Missing or duplicate operation ID in " + node.id);
    operationIds.add(operation.id);
    if (!operation.name || operation.description.trim().length < 20) failures.push("Missing LLM-ready description: " + node.id + "/" + operation.id);
    if (!operation.inputSchema || !operation.outputSchema || typeof operation.run !== "function") failures.push("Missing schema or run handler: " + node.id + "/" + operation.id);
    try { operation.inputSchema.toJSONSchema(); operation.outputSchema.toJSONSchema(); } catch { failures.push("Schema cannot be exported to JSON Schema: " + node.id + "/" + operation.id); }
  }
  if (node.auth.type === "oauth2" && (!node.auth.scopes.length || !node.auth.refresh)) failures.push("OAuth config needs scopes and refresh behavior: " + node.id);
  if ((node.auth.type === "apiKey" || node.auth.type === "connectionString") && !node.auth.credentialKey) failures.push("Credential key is required: " + node.id);
}

if (failures.length) {
  console.error("Node registry validation failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log("Validated " + nodes.length + " nodes and " + nodes.reduce((count, node) => count + node.triggers.length + node.actions.length, 0) + " operations.");
}
