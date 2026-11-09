"use client";

import { useMemo } from "react";

type Field = { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown };
type Operation = { id: string; name: string; description: string; inputSchema: { properties?: Record<string, Field>; required?: string[] } };
type CatalogNode = { id: string; name: string; triggers: Operation[]; actions: Operation[] };
type Props = { catalog: CatalogNode[]; kind: "trigger" | "action"; nodeId: string; operationId: string; input: Record<string, unknown>; onChange: (nodeId: string, operationId: string, input: Record<string, unknown>) => void };

export default function RegistryOperationSettings({ catalog, kind, nodeId, operationId, input, onChange }: Props) {
  const available = useMemo(() => catalog.filter((node) => (kind === "trigger" ? node.triggers : node.actions).length), [catalog, kind]);
  const selectedNode = catalog.find((node) => node.id === nodeId) ?? available[0];
  const operations = selectedNode ? (kind === "trigger" ? selectedNode.triggers : selectedNode.actions) : [];
  const operation = operations.find((item) => item.id === operationId) ?? operations[0];
  const properties = operation?.inputSchema.properties ?? {};
  const required = operation?.inputSchema.required ?? [];
  function chooseNode(nextNodeId: string) {
    const nextNode = catalog.find((node) => node.id === nextNodeId);
    const nextOperation = (kind === "trigger" ? nextNode?.triggers : nextNode?.actions)?.[0];
    if (!nextNode || !nextOperation) return;
    onChange(nextNode.id, nextOperation.id, Object.fromEntries(Object.entries(nextOperation.inputSchema.properties ?? {}).map(([key, field]) => [key, field.default ?? ""])));
  }
  function chooseOperation(nextOperationId: string) {
    const next = operations.find((item) => item.id === nextOperationId);
    if (!next || !selectedNode) return;
    onChange(selectedNode.id, next.id, Object.fromEntries(Object.entries(next.inputSchema.properties ?? {}).map(([key, field]) => [key, field.default ?? ""])));
  }
  function changeField(key: string, value: unknown) { if (selectedNode && operation) onChange(selectedNode.id, operation.id, { ...input, [key]: value }); }
  return <section className="step-config-fields">
    <div className="config-section-title">Registered {kind} operation</div>
    <label htmlFor={kind + "-registry-node"}>App / node</label>
    <select id={kind + "-registry-node"} value={selectedNode?.id ?? ""} onChange={(event) => chooseNode(event.target.value)}>
      {available.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
    </select>
    <label htmlFor={kind + "-registry-operation"}>Operation</label>
    <select id={kind + "-registry-operation"} value={operation?.id ?? ""} onChange={(event) => chooseOperation(event.target.value)}>
      {operations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    {operation && <><p className="config-note">{operation.description}</p><div className="config-section-title">Operation inputs</div>
      {Object.entries(properties).map(([key, field]) => {
        const value = input[key] ?? field.default ?? "";
        const id = kind + "-input-" + key;
        return <div key={key}><label htmlFor={id}>{field.title ?? key}{required.includes(key) && <span> Required</span>}</label>
          {field.enum?.length ? <select id={id} value={String(value)} onChange={(event) => changeField(key, event.target.value)}><option value="">Choose…</option>{field.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select>
          : field.type === "boolean" ? <select id={id} value={String(value)} onChange={(event) => changeField(key, event.target.value === "true")}><option value="true">True</option><option value="false">False</option></select>
          : field.type === "number" || field.type === "integer" ? <input id={id} type="number" value={value === "" ? "" : Number(value)} onChange={(event) => changeField(key, event.target.value === "" ? "" : Number(event.target.value))}/>
          : field.type === "object" || field.type === "array" ? <textarea id={id} rows={3} value={typeof value === "string" ? value : JSON.stringify(value, null, 2)} onChange={(event) => { try { changeField(key, JSON.parse(event.target.value)); } catch { changeField(key, event.target.value); } }}/>
          : <input id={id} value={String(value)} onChange={(event) => changeField(key, event.target.value)} placeholder={field.description ?? ""}/>}
          {field.description && <p className="config-note">{field.description}</p>}</div>;
      })}
      {!Object.keys(properties).length && <p className="config-note">This operation has no configurable inputs.</p>}
    </>}
  </section>;
}