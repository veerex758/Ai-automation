import type { NodeDefinition } from "./types";
import { openaiNode } from "./openai";
import { webhooksNode } from "./webhooks";
import { slackNode } from "./slack";
import { emailNode } from "./email";
import { manualNode } from "./manual";
import { additionalNodes } from "./additional";
import { utilityLogicNodes } from "./utility-logic";
import { fileDocumentNodes } from "./file-document";
import { aiProviderNodes } from "./ai-providers";
import { communicationMarketingNodes } from "./communication-marketing";
import { crmMarketingNodes } from "./crm-marketing";
import { analyticsNodes } from "./analytics";
import { analyticsExtraNodes } from "./analytics-extra";
import { messagingDirectoryNodes } from "./messaging-directory";
import { emailMarketingExtraNodes } from "./email-marketing-extra";
import { commerceNodes } from "./commerce-finance";
import { infrastructureNodes } from "./infrastructure";
import { productivityNodes } from "./productivity";
import { httpRequestNode } from "./http-request";
import { scheduleTriggerNode } from "./schedule-trigger";

export const nodes: NodeDefinition[] = [manualNode, webhooksNode, openaiNode, slackNode, emailNode, ...additionalNodes, ...utilityLogicNodes, ...fileDocumentNodes, ...aiProviderNodes, ...communicationMarketingNodes, ...crmMarketingNodes, ...analyticsNodes, ...analyticsExtraNodes, ...messagingDirectoryNodes, ...emailMarketingExtraNodes, ...commerceNodes, ...infrastructureNodes, ...productivityNodes, httpRequestNode, scheduleTriggerNode];

export function findNode(nodeId: string): NodeDefinition | undefined {
  return nodes.find((node) => node.id === nodeId);
}

export function findOperation(nodeId: string, operationId: string, kind: "trigger" | "action") {
  const node = findNode(nodeId);
  return kind === "trigger"
    ? node?.triggers.find((operation) => operation.id === operationId)
    : node?.actions.find((operation) => operation.id === operationId);
}

function publicSchema(schema: { toJSONSchema: () => Record<string, unknown> }) {
  try {
    return schema.toJSONSchema();
  } catch {
    // Keep catalog listing available even if a provider-specific Zod schema has an unsupported JSON Schema construct.
    return { type: "object", additionalProperties: true, description: "Input/output schema unavailable; validate using the node runtime." };
  }
}

export function getPublicNodeCatalog() {
  return nodes.map(({ id, name, icon, category, version, auth, triggers, actions }) => ({
    id, name, icon, category, version, auth,
    triggers: triggers.map(({ id: operationId, name: operationName, description, inputSchema, outputSchema }) => ({
      id: operationId, name: operationName, description,
      inputSchema: publicSchema(inputSchema), outputSchema: publicSchema(outputSchema),
    })),
    actions: actions.map(({ id: operationId, name: operationName, description, inputSchema, outputSchema }) => ({
      id: operationId, name: operationName, description,
      inputSchema: publicSchema(inputSchema), outputSchema: publicSchema(outputSchema),
    })),
  }));
}
