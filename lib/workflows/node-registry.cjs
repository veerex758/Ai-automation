/* global module */
/* eslint-disable @typescript-eslint/no-require-imports -- This registry is CommonJS to match the existing action catalog. */
const { getActionCatalog } = require("./action-catalog.cjs");

const triggers = [
  {
    id: "trigger.manual",
    type: "trigger",
    provider: "core",
    operation: "manual",
    label: "Run manually",
    description: "Start a workflow from an explicit user-initiated run.",
    auth: "workspace_session",
    execution: "supported",
    fields: [],
  },
  {
    id: "trigger.webhook",
    type: "trigger",
    provider: "webhook",
    operation: "receive_event",
    label: "Receive webhook",
    description: "Start a workflow when an external service sends an HTTP event.",
    auth: "signed_secret",
    execution: "registry_only",
    fields: [
      { name: "event", label: "Event type", type: "text", required: true, maxLength: 100 },
    ],
    requirements: ["unique_endpoint", "signed_request_validation", "durable_queue"],
  },
  {
    id: "trigger.record_created",
    type: "trigger",
    provider: "core",
    operation: "record_created",
    label: "Record created",
    description: "Start a workflow when a supported record is created.",
    auth: "workspace_session",
    execution: "registry_only",
    fields: [],
  },
  {
    id: "trigger.schedule",
    type: "trigger",
    provider: "core",
    operation: "schedule",
    label: "Schedule",
    description: "Start a workflow on a configured schedule.",
    auth: "server_managed",
    execution: "existing_scheduler",
    fields: [],
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getNodeRegistry() {
  const actions = getActionCatalog().map((action) => ({
    ...action,
    type: "action",
    auth: action.requirements?.includes("server_credentials") ? "server_secret" : "none",
  }));
  return {
    version: 1,
    triggers: clone(triggers),
    actions: clone(actions),
    policy: {
      defaultMode: "dry_run",
      liveExecutionEnabledByDefault: false,
      note: "Registry metadata is descriptive. A node is live-capable only when its execution adapter and required security controls are implemented.",
    },
  };
}

function findNode(id) {
  const registry = getNodeRegistry();
  return [...registry.triggers, ...registry.actions].find((node) => node.id === id) ?? null;
}

module.exports = { getNodeRegistry, findNode };
