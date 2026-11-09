"use client";

import type { ChangeEvent } from "react";

type SchemaField = { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown; format?: string };
type RegistryOperation = { id: string; name: string; description: string; inputSchema: { properties?: Record<string, SchemaField>; required?: string[] } };
type RegistryNode = { id: string; name: string; icon?: string; category?: string; triggers: RegistryOperation[]; actions: RegistryOperation[] };
type Props = {
  catalog: RegistryNode[];
  kind: "trigger" | "action";
  nodeId: string;
  operationId: string;
  input: Record<string, unknown>;
  onChange: (nodeId: string, operationId: string, input: Record<string, unknown>) => void;
};

/** Schema-driven settings editor: no provider/operation allowlists in the canvas. */
export default function RegistryOperationSettings({ catalog, kind, nodeId, operationId, input, onChange }: Props) {
  const node = catalog.find((item) => item.id === nodeId);
  const operations = kind === "trigger" ? node?.triggers ?? [] : node?.actions ?? [];
  const operation = operations.find((item) => item.id === operationId) ?? operations[0];
  const fields = operation?.inputSchema.properties ?? {};
  const required = new Set(operation?.inputSchema.required ?? []);
  function update(key: string, value: unknown) {
    onChange(nodeId, operation?.id ?? operationId, { ...input, [key]: value });
  }
  return <section className="step-config-fields" aria-label="Registered ope¶»§q«^