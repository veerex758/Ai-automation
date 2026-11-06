import { nodes } from "@/nodes/registry";
import type { NodeDefinition } from "@/nodes/types";

export type WorkerOperationKind = "trigger" | "action";
export type WorkerOperationMapping = {
  nodeId: string;
  operationId: string;
  kind: WorkerOperationKind;
  provider: string | null;
};

const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  email: "resend",
  google_sheets: "sheets",
  http_request: "http",
};

function mappingFor(node: NodeDefinition, operationId: string, kind: WorkerOperationKind): WorkerOperationMapping {
  return {
    nodeId: node.id,
    operationId,
    kind,
    provider: PROVIDER_ALIASES[node.id] ?? (node.auth.type === "none" ? null : node.id),
  };
}

const entries = nodes.flatMap((node) => [
  ...node.triggers.map((operation) => mappingFor(node, operation.id, "trigger")),
  ...node.actions.map((operation) => mappingFor(node, operation.id, "action")),
]);

export const WORKER_OPERATION_MAP: ReadonlyMap<string, WorkerOperationMapping> = new Map(
  entries.map((entry) => [entry.kind + ":" + entry.nodeId + ":" + entry.operationId, entry]),
);

export function getWorkerOperationMapping(
  step: { kind: WorkerOperationKind; nodeId: string; operationId: string },
): WorkerOperationMapping | undefined {
  return WORKER_OPERATION_MAP.get(step.kind + ":" + step.nodeId + ":" + step.operationId);
}

export function getWorkerProvider(step: { kind: WorkerOperationKind; nodeId: string; operationId: string }): string | null {
  return getWorkerOperatio¶»§q«^