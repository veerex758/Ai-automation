import type { NodeDefinition } from "./types";
import { openaiNode } from "./openai";
import { geminiNode } from "./gemini";
import { webhooksNode } from "./webhooks";
import { slackNode } from "./slack";
import { emailNode } from "./email";
import { manualNode } from "./manual";
import { gmailNode, sheetsNode, notionNode, hubspotNode, twilioNode, shopifyNode, stripeNode, linearNode } from "./integrations";
import { providerCatalog } from "./provider-catalog";
import { dataNodes } from "./data";

/** Only these definitions have validated schemas and executable server handlers. */
export const nodes: NodeDefinition[] = [
  manualNode, webhooksNode, openaiNode, geminiNode, slackNode, emailNode,
  gmailNode, sheetsNode, notionNode, hubspotNode, twilioNode, shopifyNode, stripeNode, linearNode,
  ...dataNodes,
];

export function findNode(nodeId: string): NodeDefinition | undefined {
  return nodes.find((node) => node.id === nodeId);
}

export function findOperation(nodeId: string, operationId: string, kind: "trigger" | "action") {
  const node = findNode(nodeId);
  return kind === "trigger"
    ? node?.triggers.find((operation) => operation.id === operationId)
    : node?.actions.find((operation) => operation.id === operationId);
}

function publicOperation(operation: NodeDefinition["actions"][number]) {
  return {
    id: operation.id,
    name: operation.name,
    description: operation.description,
    inputSchema: operation.inputSchema.toJSONSchema(),
    outputSchema: operation.outputSchema.toJSONSchema(),
  };
}

/**
 * Exposes all requested providers to the authenticated directory while
 * marking only real registry-backed adapters as executable. The AI planner
 * and runner continue to use nodes/findOperation, never this catalogue.
 */
export function getPublicNodeCatalog() {
  const implementations = new Map(nodes.map((node) => [node.id, node]));
  return providerCatalog.map((entry) => {
    const implementation = entry.registryId ? implementations.get(entry.registryId) : undefined;
    return {
      id: entry.id,
      name: entry.name,
      icon: implementation?.icon ?? "plug",
      category: entry.category,
      group: entry.group,
      version: implementation?.version ?? 1,
      auth: implementation?.auth ?? { type: entry.auth },
      executionStatus: implementation ? "registered" as const : "coming_soon" as const,
      triggers: implementation?.triggers.map(publicOperation) ?? [],
      actions: implementation?.actions.map(publicOperation) ?? [],
    };
  });
}
