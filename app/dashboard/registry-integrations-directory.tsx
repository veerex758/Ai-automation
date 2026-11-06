"use client";

import { useEffect, useMemo, useState } from "react";

type Operation = { id: string; name: string; description: string; inputSchema?: unknown; outputSchema?: unknown };
type RegistryNode = {
  id: string; name: string; icon: string; category: string; group: string; version: number;
  executionStatus: "registered" | "coming_soon";
  auth: { type: "none" | "oauth2" | "apiKey" | "connectionString" };
  triggers: Operation[]; actions: Operation[];
};
type ConnectionState = "connected" | "not-connected" | "unverified" | "coming-soon" | "no-connection" | "setup-required";
type ConnectionRecord = {
  provider: string; status?: string | null; last_test_status?: string | null;
  last_tested_at?: string | null; account_email?: string | null; product?: string;
};
type CatalogPayload = { nodes?: RegistryNode[]; error?: string };
type WorkspacePayload = { integrations?: ConnectionRecord[]; liveExecutionEnabled?: boolean; liveProvidersEnabled?: string[]; error?: string };
type GooglePayload = { connections?: ConnectionRecord[]; error?: string };
type ApprovalRecord = { node_id: string; operation_id: string; decision: "approved" | "revoked" };
type ApprovalPayload = { approvals?: ApprovalRecord[]; error?: string };

const officialBrandAssets: Record<string, { slug: string; label: string }> = {
  "openai": {
    "slug": "openai",
    "label": "openai"
  },
  "gemini": {
    "slug": "googlegemini",
    "label": "Google Gemini"
  },
  "slack": {
    "slug": "slack",
    "label"¶»§q«^