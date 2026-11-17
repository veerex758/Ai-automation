/* global module, process, fetch */
/* eslint-disable @typescript-eslint/no-require-imports -- This server-side helper intentionally uses CommonJS to match adjacent .cjs modules. */
const { validateDefinition } = require("./validate-definition.cjs");
const { getNodeRegistry } = require("./node-registry.cjs");
const MAX_PROMPT_LENGTH = 2000;
const DEFAULT_MODEL = "gemini-3.8-flash";
const PROVIDER_TIMEOUT_MS = 10000;
const MAX_PRIMARY_503_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 400;
const MAX_RETRY_AFTER_MS = 1500;
const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";


function extractJson(content) {
  if (typeof content !== "string") throw new Error("AI_EMPTY_RESPONSE");
  const fence = String.fromCharCode(96).repeat(3);
  const trimmed = content.trim().replace(new RegExp("^" + fence + "(?:json)?\\s*", "i"), "").replace(new RegExp("\\s*" + fence + "$"), "");
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch { throw new Error("AI_INVALID_JSON"); }
  return parsed;
}

function assertStrictDraftShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI_UNSAFE_WORKFLOW");
  if (Object.keys(value).some((key) => !["version", "nodes", "edges"].includes(key))) throw new Error("AI_UNSAFE_WORKFLOW");
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error("AI_UNSAFE_WORKFLOW");
  const nodeKeys = new Set(["id", "type", "title", "description", "settings"]);
  for (const node of value.nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node) || Object.keys(node).some((key) => !nodeKeys.has(key))) throw new Error("AI_UNSAFE_WORKFLOW");
    if (!node.settings || typeof node.settings !== "object" || Array.isArray(node.settings)) throw new Error("AI_UNSAFE_WORKFLOW");
  }
  const edgeKeys = new Set(["id", "source", "target", "label"]);
  for (const edge of value.edges) {
    if (!edge || typeof edge !== "object" || Array.isArray(edge) || Object.keys(edge).some((key) => !edgeKeys.has(key))) throw new Error("AI_UNSAFE_WORKFLOW");
  }
  return value;
}

function normalizeBaseUrl(value, env, provider) {
  const defaultUrl = provider === "openai" ? "https://api.openai.com/v1" : "https://generativelanguage.googleapis.com/v1beta/openai";
  const raw = (value || defaultUrl).replace(/\/+$/, "");
  let url;
  try { url = new URL(raw); } catch { throw new Error("AI_CONFIGURATION_ERROR"); }
  if (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("AI_CONFIGURATION_ERROR");
  return raw;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getRetryAfterMs(headers) {
  if (!headers || typeof headers.get !== "function") return 0;
  const value = headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  const requested = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : Math.max(0, Date.parse(value) - Date.now());
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.ceil(requested)));
}

async function requestGeminiModel({ baseUrl, apiKey, model, systemPrompt, prompt, fetchImpl, isFallback = false }) {
  const providerResult = await requestWithRetryAndFallback({
    baseUrl, apiKey, model, fallbackModel, systemPrompt, prompt, fetchImpl, sleepImpl, randomImpl,
  });
  const parsed = providerResult.parsed;
  const modelUsed = providerResult.modelUsed;
  const fallbackUsed = providerResult.fallbackUsed;
  if (mode === "registry") {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.keys(parsed).some((key) => !["registrySteps", "edges"].includes(key)) ||
        !Array.isArray(parsed.registrySteps) || parsed.registrySteps.length < 1 || parsed.registrySteps.length > 30 ||
        !Array.isArray(parsed.edges) || parsed.edges.length > 90) throw new Error("AI_UNSAFE_WORKFLOW");
    return {
      registrySteps: parsed.registrySteps,
      ...(Array.isArray(parsed.edges) ? { edges: parsed.edges } : {}),
      summary: "Registry-backed graph draft. Review node inputs and connections before saving or testing.",
      saved: false, executed: false,
      providerModelUsed: modelUsed, providerFallbackUsed: fallbackUsed,
    };
  }
  const candidate = assertStrictDraftShape(parsed);
  const validated = validateDefinition(candidate);
  if (!validated.definition) throw new Error("AI_UNSAFE_WORKFLOW");
  return { definition: validated.definition, summary: "AI-generated draft. Review every step and replace any placeholders before saving.", saved: false, executed: false, providerModelUsed: modelUsed, providerFallbackUsed: fallbackUsed };
}
module.exports = { generateWorkflow, extractJson, MAX_PROMPT_LENGTH, PROVIDER_TIMEOUT_MS, MAX_PRIMARY_503_RETRIES, RETRY_BASE_DELAY_MS, DEFAULT_FALLBACK_MODEL };
