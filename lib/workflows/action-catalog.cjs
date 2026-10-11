/* global module */

const actions = [
  {
    id: "internal.create_task",
    provider: "internal",
    operation: "create_task",
    label: "Create internal task",
    description: "Prepare a task as part of the workflow. Current execution is simulation-only.",
    category: "internal",
    execution: "dry_run_only",
    fields: [
      { name: "message", label: "Task details", type: "text", required: false, maxLength: 500 },
    ],
  },
  {
    id: "email.send_email",
    provider: "email",
    operation: "send_email",
    label: "Send email",
    description: "Send one approved email through the guarded Resend integration.",
    category: "communication",
    execution: "live_guarded",
    fields: [
      { name: "recipient", label: "Recipient email", type: "email", required: true, maxLength: 254 },
      { name: "message", label: "Email message", type: "text", required: false, maxLength: 500 },
    ],
    requirements: ["server_credentials", "verified_sender", "recipient_allowlist", "explicit_live_execution_flag"],
  },
  {
    id: "slack.send_message",
    provider: "slack",
    operation: "send_message",
    label: "Send Slack message",
    description: "Prepare a Slack message. A live Slack connector is not enabled yet.",
    category: "communication",
    execution: "dry_run_only",
    fields: [
      { name: "recipient", label: "Channel or recipient", type: "text", required: true, maxLength: 200 },
      { name: "message", label: "Message", type: "text", required: false, maxLength: 500 },
    ],
  },
  {
    id: "webhook.http_request",
    provider: "webhook",
    operation: "http_request",
    label: "Send HTTPS webhook request",
    description: "Describe an outbound HTTPS request. Dry-run mode never contacts the destination.",
    category: "developer",
    execution: "dry_run_only",
    fields: [
      { name: "url", label: "HTTPS endpoint", type: "url", required: true, maxLength: 500 },
      { name: "message", label: "Payload description", type: "text", required: false, maxLength: 500 },
    ],
    requirements: ["https_url"],
  },
];

function getActionCatalog() {
  return actions.map((action) => ({
    ...action,
    fields: action.fields.map((field) => ({ ...field })),
    ...(action.requirements ? { requirements: [...action.requirements] } : {}),
  }));
}

function findAction(provider, operation) {
  const action = actions.find((item) => item.provider === provider && item.operation === operation);
  return action ? getActionCatalog().find((item) => item.id === action.id) : null;
}

module.exports = { getActionCatalog, findAction };
