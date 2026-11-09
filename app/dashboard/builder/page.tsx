"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { validateWorkflowDefinition } from "@/lib/workflows/validation";
import actionFieldValidation from "@/lib/workflows/action-field-validation.cjs";

const { isValidEmail, isHttpsUrl } = actionFieldValidation;
import "./builder.css";

type StepKind = "Trigger" | "Action" | "Condition";
type ActionField = {
  name: string;
  label: string;
  type: "text" | "email" | "url";
  required: boolean;
  maxLength: number;
};
type RegistryCatalogNode = {
  id: string;
  name: string;
  icon: string;
  category: string;
  group: string;
  executionStatus: "registered" | "coming_soon";
  triggers: {
    id: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[];
  actions: {
    id: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[];
};
type CatalogAction = {
  id: string;
  provider: string;
  operation: string;
  label: string;
  description: string;
  category: string;
  execution: "dry_run_only" | "live_guarded";
  fields: ActionField[];
  requirements?: string[];
};
type BuilderStep = {
  id: number;
  kind: StepKind;
  title: string;
  detail: string;
  actionId?: string;
  settings?: Record<string, string>;
  registryBacked?: boolean;
};
type GeneratedNode = {
  id: string;
  type: "trigger" | "action" | "condition";
  title: string;
  description: string;
  settings: Record<string, string>;
};
ty¶»§q«^