import type { NodeDefinition } from "./types";
import { openaiNode } from "./openai";
import { webhooksNode } from "./webhooks";

export const nodes: NodeDefinition[] = [webhooksNode, openaiNode];

export function findNode(nodeId: string): NodeDefinition | undefined {
  return nodes.find((node) => node.id === nodeId);
}

export function findOperation(nodeId: string, operationId: string, kind: "trigger" | "action") {
  const node = findNode(nodeId);
  return kind === "trigger"
    ? node?.triggers.find((operation) => operation.id === operationId)
    : node?.actions.find((operation) => operation.id === operationId);
}

export function getPublicNodeCatalog() {
  return nodes.map(({ id, name, icon, category, version, auth, triggers, actions }) => ({
    id, name, icon, category, version, auth,
    triggers: triggers.map(({ id: operationId, name: operationName, description, inputSchema, outputSchema }) => ({
      id: operationId, name: operationName, description,
      inputSchema: inputSchema.toJSONSchema(), outputSchema: outputSchema.toJSONSchema(),
    })),
    actions: actions.map(({ id: operationId, name: operationName, description, inputSchema, outputSchema }) => ({
      id: operationId, name: operationName, description,
      inputSchema: inputSchema.toJSONSchema(), outputSchema: outputSchema.toJSONSchema(),
    })),
  }));
}
