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
const report = [
  "# Aivanta provider execution verification",
  "",
  "- Catalogue entries: " + providerCatalog.length,
  "- Native registry nodes: " + nodes.length,
  "- All native registry operations: " + rows.length,
  "- Worker operation mappings: " + (rows.length - missing.length),
  "- Missing mappings: " + missing.length,
  "- Authenticated staging/live verification: BLOCKED",
  "- No provider is labelled live-verified",
  "",
  "The report verifies static registry-to-worker mapping only. It does not imply credentials, external provider consent, database service execution, or authenticated staging have been tested.",
  "",
  "| Provider | Operation | Worker mapping |",
  "|---|---|---|",
  ...rows.map((row) => "| " + row.provider + " | " + row.operation + " | " + row.mapping + " |"),
  "",
  "## Database adapters",
  "",
  "- MySQL (mysql): registered real-driver adapter; live database verification requires the authenticated TLS service workflow.",
  "- MongoDB (mongodb): registered real-driver adapter; live database verification requires the authenticated TLS service workflow.",
  "",
  "## Release gate",
  "",
  "Do not enable live execution or merge based on this static report. Require green complete CI, passing MySQL/MongoDB TLS integration tests, and authenticated staging evidence.",
  "",
].join("\n");
if (missing.length) throw new Error("PROVIDER_OPERATION_MAPPING_MISSING");
await writeFile("docs/integrations/provider-verification-report.md", report, "utf8");
console.log("Provider verification report written: " + rows.length + " operations, " + missing.length + " missing mappings.");
