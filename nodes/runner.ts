import { findOperation } from "./registry";
import type { NodeContext } from "./types";

export async function executeRegisteredOperation(args: {
  nodeId: string;
  operationId: string;
  kind: "trigger" | "action";
  context: NodeContext;
  input: unknown;
}) {
  const operation = findOperation(args.nodeId, args.operationId, args.kind);
  if (!operation) throw new Error("NODE_OPERATION_NOT_FOUND");
  const input = operation.inputSchema.parse(args.input);
  const output = await operation.run(args.context, input);
  return operation.outputSchema.parse(output);
}
