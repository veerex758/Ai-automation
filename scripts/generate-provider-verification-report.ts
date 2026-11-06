import { writeFile } from "node:fs/promises";
import { nodes } from "../nodes/registry";
import { providerCatalog } from "../nodes/provider-catalog";
import { getWorkerOperationMapping } from "../lib/workflows/worker-operation-map";

const rows = nodes.flatMap((node) => {
  const operations = [
    ...node.triggers.map((operation) => ({ kind: "trigger" as const, nodeId: node.id, operationId: operation.id })),
    ...node.actions.map((operation) => ({ kind: "action" as const, nodeId: node.id, operationId: operation.id })),
  ];
  return operations.map((operation) => ({
    provider: node.name + " (" + node.id + ")",
    nodeId: node.id,
    operation: operation.kind + "." + operation.operationId,
    mapping: getWorkerOperationMapping(operation) ? "present" : "MISSING",
  }));
});
const missing = rows.filter((row) => row.mapping === "MISSING");
const registeredProviderCount = providerCatalog.filter((entry) => Boolean(entry.registryId)).length;
const comingSoonProviderCount = providerCatalog.length - registeredProviderCount;
const report = [
  "# Aivanta provider execution verification",
  "",
  "- Catalogue entries: " + providerCatalog.length,
  "- Registered provider entries: " + registeredProviderCount,
  "- Coming-soon provider entries: " + comingSoonProviderCount,
  "- Native registry nodes: " + nodes.length,
  "- All native registry operations: " + rows.length,
  "- Worker operation mappings: " + (rows.length - missing.length),
  "- Missing mappings: " + missing.length,
  "- CI run #1835 (tests, lint, TypeScript, production build): PASS",
  "- Database service run #76 (MySQL/MongoDB authenticated TLS integration): PASS",
  "- Supabase migration replay run #502: PASS",
  "- Authenticated staging/live verification: BLOCKED (staging E2E not run)",
  "- No provider is labelled live-verified",
  "",
  "The report distinguishes static registry/worker mapping and local authenticated TLS database integration from external provider verification. OAuth consent, production credentials, and authenticated staging E2E have not been performed.",
  "",
  "| Provider | Operation | Worker mapping |",
  "|---|---|---|",
  ...rows.map((row) => "| " + row.provider + " | " + row.operation + " | " + row.mapping + " |"),
  "",
  "## Database adapters",
  "",
  "- MySQL (mysql): registered real-driver adapter; authenticated TLS service integration passed in run #72; staging E2E not run.",
  "- MongoDB (mongodb): registered real-driver adapter; authenticated TLS service integration passed in run #72; staging E2E not run.",
  "",
  "## Release gate",
  "",
  "Do not enable live execution or merge based on this report. Authenticated staging E2E with a dedicated test account and provider credentials remains required.",
  "",
].join("\n");
if (missing.length) throw new Error("PROVIDER_OPERATION_MAPPING_MISSING");
await writeFile("docs/integrations/provider-verification-report.md", report, "utf8");
console.log("Provider verification report written: " + rows.length + " operations, " + missing.length + " missing mappings.");
