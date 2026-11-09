import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeRegisteredWorkflow, type RegisteredWorkflowStep } from "@/nodes/workflow-runner";
import type { NodeContext } from "@/nodes/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function serverContext(): Omit<NodeContext, "previousOutputs"> {
  const credentials: Record<string, Record<string, string>> = {};
  if (process.env.OPENAI_API_KEY) credentials.openai = { apiKey: process.env.OPENAI_API_KEY };
  if (process.env.SLACK_INCOMING_WEBHOOK_URL) credentials.slack = { webhookUrl: process.env.SLACK_INCOMING_WEBHOOK_URL };
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    credentials.resend = { apiKey: process.env.RESEND_API_KEY, fromEmail: process.env.RESEND_FROM_EMAIL };
  }
  return {
    credentials,
    logger: {
      info(message, meta) { console.info("[registry-node]", message, meta ?? {}); },
      error(message, meta) { console.error("[registry-node]", message, meta ?? {}); },
    },
    http: {
      async request(args) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 15000);
        try {
          const response = await fetch(args.url, {
           ¶»§q«^