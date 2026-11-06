import type { AuthConfig } from "./types";

export type ProviderCatalogEntry = {
  id: string;
  name: string;
  category: string;
  group: string;
  auth: AuthConfig["type"];
  registryId?: string;
};

/** Complete user-facing inventory. Catalogue-only entries are never executable. */
export const providerCatalog: ProviderCatalogEntry[] = [
  {
    "id": "webhook_trigger",
    "name": "Webhook Trigger",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "webhooks"
  },
  {
    "id": "schedule_cron",
    "name": "Schedule/Cron",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "schedule"
  },
  {
    "id": "manual_trigger",
    "name": "Manual Trigger",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "manual"
  },
  {
    "id": "http_request",
    "name": "HTTP Request",
    "category": "core",
    "group": "Core and logic",
    "auth": "apiKey",
    "registryId": "http_request"
  },
  {
    "id": "if",
    "name": "IF",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "if"
  },
  {
    "id": "switch",
    "name": "Switch",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "switch"
  },
  {
    "id": "loop",
    "name": "Loop",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "loop"
  },
  {
    "id": "merge",
    "nam¶»§q«^