"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "./builder.css";
import RunTestPanel from "./run-test-panel";
import RegistryOperationSettings from "./registry-operation-settings";
type RegistryCatalog = { id: string; name: string; icon?: string; category?: string; triggers: { id: string; name: string; description: string; inputSchema: { properties?: Record<string, { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown }>; required?: string[] } }[]; actions: { id: string; name: string; description: string; inputSchema: { properties?: Record<string, { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown }>; required?: string[] } }[] };

type NodeType = "trigger" | "action" | "condition";
type WorkflowNode = { id: string; type: NodeType; title: string; description: string; settings: Record<string, string>; registryNodeId?: string; registryOperationId?: string; registryInput?: Record<string, unknown>; position?: { x: number; y: number } };
type WorkflowEdge = { id: string; source: string; target: string; label: "true" | "false" | "next" };
type Definition = { version: 1; nodes: WorkflowNode[]; edges?: WorkflowEdge[] };
type Workflow = { id: string; name: string; description: string; status: string };
type WorkflowVersion = { version¶»§q«^