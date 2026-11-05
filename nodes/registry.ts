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
import { ifNode, switchNode, mergeNode } from "./core-logic";
import { httpRequestNode } from "./http-request";
import { waitNode } from "./wait";
import { scheduleNode } from "./schedule";
import { loopNode } from "./loop";
import { javascriptNode } from "./javascript";
import { utilityPack } from "./utility-pack";
import { providerPack } from "./provider-pack";
import { catalogueAiNodes } from "./catalogue-ai-pack";

/** Only these definitions have validated schemas and executable server handlers. */
export const nodes: NodeDefinition[] = [
  manualNode, webhooksNode, openaiNode, geminiNode, slackNode, emailNode,
  gmailNode, sheetsNode, notionNode, hubspotNode, twilioNode, shopifyNode, stripeNode, linearNode,
  ...dataNodes, ifNode, switchNode, mergeNode, httpRequestNode, waitNode, scheduleNode, loopNode, javascriptNode, ...utilityPack, ...providerPack, ...catalogueAiNodes,
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
      registryNodeId: implementation?.id ?? null,
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

/** Returns only registered definitions for AI planning and execution validation. */
export function getExecutableNodeCatalog() {
  // Build the AI-facing catalogue from the native registry itself so every
  // executable node appears exactly once, including internal utility nodes.
  // Provider metadata is an optional presentation layer, never the source of
  // truth for executable membership or cardinality.
  const providerEntries = new Map(
    getPublicNodeCatalog()
      .filter((entry) => entry.executionStatus === "registered" && entry.registryNodeId)
      .map((entry) => [entry.registryNodeId as string, entry]),
  );

  return nodes.map((node) => {
    const providerEntry = providerEntries.get(node.id);
    return providerEntry
      ? { ...providerEntry, id: node.id }
      : {
          id: node.id,
          name: node.name,
          icon: node.icon,
          category: node.category,
          group: node.category,
          version: node.version,
          auth: node.auth,
          executionStatus: "registered" as const,
          triggers: node.triggers.map(publicOperation),
          actions: node.actions.map(publicOperation),
        };
  });
}
