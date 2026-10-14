#!/usr/bin/env node

import { buildStagingRequestUrl } from "../lib/staging/request-url.mjs";

const rawBaseUrl = process.env.AIVANTA_STAGING_URL;
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!rawBaseUrl) {
  console.error("Set AIVANTA_STAGING_URL to a dedicated staging or preview deployment.");
  process.exit(2);
}

let baseUrl;
try {
  baseUrl = new URL(rawBaseUrl);
} catch {
  console.error("AIVANTA_STAGING_URL must be a valid absolute URL.");
  process.exit(2);
}

if (baseUrl.protocol !== "https:") {
  console.error("Refusing to test a non-HTTPS environment.");
  process.exit(2);
}

const host = baseUrl.hostname.toLowerCase();
const knownProductionHosts = new Set([
  "ai-automation-veerex-org.vercel.app",
  "ai-automation-git-main-veerex-org.vercel.app",
]);
const explicitlyApprovedPreviewHosts = new Set([
  "ai-automation-3oo2aepz3-veerex-org.vercel.app",
]);
const identifiesNonProduction = host.includes("staging")
  || host.includes("preview")
  || host.includes("-git-")
  || explicitlyApprovedPreviewHosts.has(host);

if (knownProductionHosts.has(host) || !identifiesNonProduction) {
  console.error("Refusing to run smoke tests: hostname must clearly identify a staging or preview deployment.");
  process.exit(2);
}

if (!bypassSecret) {
  console.error("Set VERCEL_AUTOMATION_BYPASS_SECRET in the runner's secret environment.");
  process.exit(2);
}

baseUrl.pathname = baseUrl.pathname.replace(/\/$/, "");
baseUrl.search = "";
baseUrl.hash = "";

const timeoutMs = 10_000;
const isJson = (response) => (response.headers.get("content-type") || "").includes("application/json");
const describeError = (error) => {
  const details = [];
  let current = error;
  for (let depth = 0; current && depth < 3; depth += 1) {
    const name = typeof current.name === "string" ? current.name : "Error";
    const message = typeof current.message === "string" ? current.message : "request failed";
    const code = typeof current.code === "string" ? ` [${current.code}]` : "";
    details.push(`${name}${code}: ${message}`);
    current = current.cause;
  }
  return details.join(" <- ");
};

const checks = [
  {
    name: "health endpoint",
    path: "/api/health",
    init: { method: "GET" },
    expected: [200],
    validate: async (response) => {
      if (!isJson(response)) return false;
      const body = await response.json();
      return body?.status === "ok";
    },
  },
  {
    name: "unauthenticated action catalog",
    path: "/api/workflows/actions",
    init: { method: "GET" },
    expected: [401],
    validate: async (response) => {
      if (!isJson(response)) return false;
      const body = await response.json();
      return body?.error === "Authentication required.";
    },
  },
  {
    name: "unauthenticated AI generation",
    path: "/api/ai/generate-workflow",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    expected: [401],
    validate: async (response) => {
      if (!isJson(response)) return false;
      const body = await response.json();
      return body?.error === "Authentication required.";
    },
  },
  {
    name: "unauthenticated workflow validation",
    path: "/api/workflows/validate",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    expected: [401],
    validate: async (response) => {
      if (!isJson(response)) return false;
      const body = await response.json();
      return body?.error === "Authentication required.";
    },
  },
  {
    name: "unauthenticated scheduler rejection",
    path: "/api/internal/scheduler",
    init: { method: "POST" },
    expected: [401, 503],
    validate: async (response) => {
      if (!isJson(response)) return false;
      const body = await response.json();
      return typeof body?.error === "string";
    },
  },
];

let failed = 0;
console.log(`Aivanta staging smoke test: ${baseUrl.origin}`);

for (const check of checks) {
  try {
    const headers = new Headers(check.init.headers || {});
    headers.set("x-vercel-protection-bypass", bypassSecret);
    const requestUrl = buildStagingRequestUrl(check.path, baseUrl);
    // Print only the URL components needed to diagnose malformed URL construction.
    // No request headers, cookies, credentials, or response bodies are logged.
    console.log(`Request target ${check.name}: origin=${requestUrl.origin} hostname=${requestUrl.hostname} path=${requestUrl.pathname}`);
    const response = await fetch(requestUrl, {
      ...check.init,
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!check.expected.includes(response.status)) {
      const isProtection = [301, 302, 303, 307, 308].includes(response.status)
        || response.status === 401 && response.headers.get("location");
      const detail = isProtection
        ? "received a redirect/protection response, not an application-level result"
        : `expected HTTP ${check.expected.join(" or ")}, received HTTP ${response.status}`;
      console.error(`FAIL ${check.name}: ${detail}`);
      failed += 1;
      continue;
    }

    if (check.validate && !(await check.validate(response))) {
      console.error(`FAIL ${check.name}: response did not match the application JSON contract`);
      failed += 1;
      continue;
    }

    console.log(`PASS ${check.name}: HTTP ${response.status}`);
  } catch (error) {
    const details = describeError(error);
    // A bounded stack can identify which fetch/dispatcher path threw without exposing
    // request headers or secrets. Error messages are bounded to avoid log flooding.
    const stack = typeof error?.stack === "string"
      ? error.stack.split("\n").slice(0, 6).join("\n").slice(0, 1200)
      : "";
    console.error(`FAIL ${check.name}: ${details}`);
    if (stack) console.error(`Request error stack (bounded):\n${stack}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`Smoke test failed: ${failed} of ${checks.length} checks did not pass.`);
  process.exit(1);
}

console.log(`Smoke test passed: all ${checks.length} unauthenticated checks passed.`);
