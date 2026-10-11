#!/usr/bin/env node

const rawBaseUrl = process.env.AIVANTA_STAGING_URL;

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
const identifiesNonProduction = host.includes("staging")
  || host.includes("preview")
  || host.includes("-git-");

if (knownProductionHosts.has(host) || !identifiesNonProduction) {
  console.error("Refusing to run smoke tests: hostname must clearly identify a staging or preview deployment.");
  process.exit(2);
}

baseUrl.pathname = baseUrl.pathname.replace(/\/$/, "");
baseUrl.search = "";
baseUrl.hash = "";

const timeoutMs = 10_000;
const checks = [
  {
    name: "health endpoint",
    path: "/api/health",
    init: { method: "GET" },
    expected: [200],
    validate: async (response) => {
      const body = await response.json();
      return body?.status === "ok";
    },
  },
  {
    name: "unauthenticated action catalog",
    path: "/api/workflows/actions",
    init: { method: "GET" },
    expected: [401],
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
  },
  {
    name: "unauthenticated scheduler rejection",
    path: "/api/internal/scheduler",
    init: { method: "POST" },
    expected: [401, 503],
  },
];

let failed = 0;
console.log(`Aivanta staging smoke test: ${baseUrl.origin}`);

for (const check of checks) {
  try {
    const response = await fetch(new URL(`${baseUrl.pathname}${check.path}`, baseUrl.origin), {
      ...check.init,
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
      console.error(`FAIL ${check.name}: response body did not match the expected contract`);
      failed += 1;
      continue;
    }

    console.log(`PASS ${check.name}: HTTP ${response.status}`);
  } catch (error) {
    console.error(`FAIL ${check.name}: ${error instanceof Error ? error.message : "request failed"}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`Smoke test failed: ${failed} of ${checks.length} checks did not pass.`);
  process.exit(1);
}

console.log(`Smoke test passed: all ${checks.length} unauthenticated checks passed.`);
