"use client";

import type { ChangeEvent } from "react";

type SchemaField = { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown };
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
  return <section className="step-config-fields" aria-label="Registered operation configuration">
    <div className="config-section-title">Registered {kind}</div>
    <label htmlFor="registry-node">Catalogue node</label>
    <select id="registry-node" value={nodeId} onChange={(event) => {
      const next = catalog.find((item) => item.id === event.target.value);
      const nextOperation = (kind === "trigger" ? next?.triggers : next?.actions)?.[0];
      onChange(event.target.value, nextOperation?.id ?? "", {});
    }}>
      {catalog.filter((item) => (kind === "trigger" ? item.triggers : item.actions).length > 0).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    <label htmlFor="registry-operation">Operation</label>
    <select id="registry-operation" value={operation?.id ?? ""} onChange={(event) => onChange(nodeId, event.target.value, {})}>
      {operations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    {operation?.description && <p className="config-note">{operation.description}</p>}
    {Object.entries(fields).map(([key, schema]) => {
      const value = input[key] ?? schema.default ?? "";
      const label = schema.title ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
      const id = "registry-input-" + key;
      if (schema.enum?.length) return <div key={key}><label htmlFor={id}>{label}{required.has(key) ? " *" : ""}</label><select id={id} required={required.has(key)} value={String(value)} onChange={(event) => update(key, event.target.value)}><option value="">Choose…</option>{schema.enum.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select></div>;
      const inputType = schema.type === "integer" || schema.type === "number" ? "number" : schema.type === "boolean" ? "checkbox" : schema.type === "email" ? "email" : schema.type === "uri" ? "url" : "text";
      if (inputType === "checkbox") return <label key={key} htmlFor={id}><input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => update(key, event.target.checked)} /> {label}</label>;
      return <div key={key}><label htmlFor={id}>{label}{required.has(key) ? " *" : ""}</label><input id={id} type={inputType} required={required.has(key)} value={String(value)} onChange={(event: ChangeEvent<HTMLInputElement>) => update(key, inputType === "number" ? Number(event.target.value) : event.target.value)} placeholder={schema.description ?? ""}/></div>;
    })}
    {!Object.keys(fields).length && <p className="config-note">This operation requires no input fields.</p>}
  </section>;
}
