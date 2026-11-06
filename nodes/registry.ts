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
import { catalogueCrmNodes } from "./catalogue-crm-pack";
import { catalogueGoogleNodes } from "./catalogue-google-pack";
import { catalogueProductivityNodes } from "./catalogue-productivity-pack";
import { catalogueCommerceSupportNodes } from "./catalogue-commerce-support-pack";
import { catalogueMarketingNodes } from "./catalogue-marketing-pack";
import { catalogueDatabaseNodes } from "./catalogue-database-pack";
import { sqlDocumentDatabaseNodes } from "./sql-document-databases";

/** Only these definitions have validated schemas and executable server handlers. */
exp¶»§q«^