import { readdir, readFile, writeFile } from "node:fs/promises";
import { providerCatalog } from "../nodes/provider-catalog";
import { nodes } from "../nodes/registry";
import { getWorkerOperationMapping } from "../lib/workflows/worker-operation-map";

async function main() {
  const testFiles = (await readdir("tests")).filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.mjs"));
  const testContents = await Promise.all(testFiles.map(async (name) => ({
    name,
    content: await readFile("tests/" + name, "utf8"),
  })));

  const registryOperations = nodes.flatMap((node) => [
    ...node.triggers.map((operation) => ({ kind: "trigger" as const, nodeId: node.id, operationId: operation.id })),
    ...node.actions.map((operation) => ({ kind: "action" as const, nodeId: node.id, operationId: operation.id })),
  ]);
  const totalOperations = registryOperations.length;
  const mappedOperations = registryOperations.filter((operation) => getWorkerOperationMapping(operation)).length;
  let catalogueOperations = 0;
  const rows: string[] = [];
  for (const entry of providerCatalog) {
    const node = entry.registryId ? nodes.find((candidate) => candidate.id === entry.registryId) : undefined;
    const operations = node ? [
      ...node.triggers.map((operation) => ({ kind: "trigger" as const, nodeId: node.id, operationId: operation.id })),
      ...node.actions.map((operation) => ({ kind: "action" as const, nodeId: node.id, operationId: operation.id })),
    ] : [];
    c¶»§q«^