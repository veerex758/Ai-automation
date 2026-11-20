import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const catalogSource = readFileSync("nodes/provider-catalog.ts", "utf8");
const directorySource = readFileSync("app/dashboard/registry-integrations-directory.tsx", "utf8");
const builderSource = readFileSync("app/dashboard/builder/page.tsx", "utf8");
const googleStartSource = readFileSync("app/api/integrations/google/start/route.ts", "utf8");
const googleConnectionsSource = readFileSync("app/api/integrations/google/connections/route.ts", "utf8");
const genericOAuthStartSource = readFileSync("app/api/integrations/oauth/[provider]/start/route.ts", "utf8");
const genericOAuthCallbackSource = readFileSync("app/api/integrations/oauth/[provider]/callback/route.ts", "utf8");
const genericOAuthStateSource = readFileSync("lib/integrations/provider-oauth.ts", "utf8");
const googleCallbackSource = readFileSync("app/api/integrations/google/callback/route.ts", "utf8");
const workflowActivationSource = readFileSync("app/api/workflows/[workflowId]/route.ts", "utf8");
const multiAccountMigration = readFileSync("supabase/migrations/20261120130000_rexnora_multi_account_connections.sql", "utf8");
const nodeTypesSource = readFileSync("nodes/types.ts", "utf8");
const stepValidatorSource = readFileSync("nodes/validate-steps.ts", "utf8");
const catalogRouteSource = readFileSync("app/api/integrations/catalog/route.ts", "utf8");
const registrySource = readFileSync("nodes/registry.ts", "utf8");
const credentialsSource = readFileSync("lib/integrations/workspace-credentials.ts", "utf8");
const connectionsSource = readFileSync("app/dashboard/connections/page.tsx", "utf8");
const connectionTestSource = readFileSync("app/api/integrations/workspace/test/route.ts", "utf8");
const workerSource = readFileSync("lib/workflows/durable-worker.ts", "utf8");
const resendTestSource = readFileSync("app/api/integrations/workspace/resend/test/route.ts", "utf8");
const saveRouteSource = readFileSync("app/api/integrations/workspace/route.ts", "utf8");

test("all 100 directory entries have official brand artwork or an explicit native icon path", () => {
  const ids = [...catalogSource.matchAll(/"id": "([^"]+)"/g)].map((match) => match[1]);
  const assetsBlock = directorySource.match(/const officialBrandAssets:[\s\S]*?= (\{[\s\S]*?\n\});/);
  const assets = JSON.parse(assetsBlock[1]);
  const native = new Set([
    "webhook_trigger", "schedule_cron", "manual_trigger", "http_request", "if", "switch", "loop",
    "merge", "wait_delay", "code_js", "set_fields", "json_parse", "filter", "aggregate", "date_time",
  ]);
  assert.equal(ids.length, 100);
  assert.equal(new Set(ids).size, 100);
  assert.deepEqual(ids.filter((id) => !assets[id] && !native.has(id)), []);
});

test("every workspace credential provider has a connection form", () => {
  const providerUnion = credentialsSource.match(/export type WorkspaceCredentialProvider =([\s\S]*?);/);
  assert.ok(providerUnion);
  const providers = [...providerUnion[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const formKeys = [...connectionsSource.matchAll(/^\s{2}([a-z0-9_]+): \{ label:/gm)].map((match) => match[1]);
  assert.equal(new Set(formKeys).size, formKeys.length);
  assert.deepEqual(providers.filter((provider) => !formKeys.includes(provider)), []);
});

test("new provider-pack connection checks remain read-only and fail closed when no safe check exists", () => {
  for (const provider of ["claude", "http", "mistral", "groq", "discord", "telegram", "whatsapp_business", "sendgrid", "mailgun", "postmark", "github", "gitlab", "sentry", "vercel", "calendly", "zendesk", "freshdesk", "serpapi", "openweather"]) {
    assert.match(connectionTestSource, new RegExp('case "' + provider + '":'));
    assert.match(connectionTestSource, new RegExp('"' + provider + '"'));
  }
  assert.match(connectionTestSource, /Perplexity does not expose a safe read-only credential check/);
});

test("durable live execution requires an explicitly selected, verified account in the current workspace", () => {
  assert.match(workerSource, /select\("id,status,last_test_status"\)/);
  assert.match(workerSource, /eq\("status", "connected"\)\.eq\("last_test_status", "passed"\)/);
  assert.match(workerSource, /if \(!connectionId\) throw new Error\("WORKSPACE_CONNECTION_SELECTION_REQUIRED"\)/);
  assert.match(workerSource, /if \(!selectedConnectionId\) throw new Error\("WORKSPACE_CONNECTION_SELECTION_REQUIRED"\)/);
  assert.match(workerSource, /selectedConnectionIds\.get\(provider\)/);
  assert.match(workerSource, /WORKSPACE_CONNECTION_SELECTION_REQUIRED/);
  assert.match(workerSource, /eq\("workspace_id", workspaceId\)/);
  assert.match(directorySource, /item\.last_test_status === "passed"/);
  assert.match(directorySource, /liveExecutionEnabled && liveProvidersEnabled\.includes\(providerPermissionKey\)/);
  assert.match(directorySource, /state === "connected" && livePermissionEnabled/);
});

test("every credential provider has a non-destructive verification path or an explicit safe exception", () => {
  const providerUnion = credentialsSource.match(/export type WorkspaceCredentialProvider =([\s\S]*?);/);
  assert.ok(providerUnion);
  const providers = [...providerUnion[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const testableBlock = connectionTestSource.match(/const TESTABLE = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(testableBlock);
  const testable = [...testableBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(providers.filter((provider) => !testable.includes(provider)), ["resend"]);
  assert.match(resendTestSource, /last_test_status: "passed"/);
  assert.match(connectionTestSource, /Perplexity does not expose a safe read-only credential check/);
});

test("saving, rotating and re-testing one account invalidates only that account's previous verification", () => {
  assert.match(saveRouteSource, /db\.rpc\("save_workspace_integration_connection"/);
  assert.match(saveRouteSource, /p_connection_id: connectionId \?\? null/);
  assert.match(multiAccountMigration, /last_test_status = null/);
  assert.match(connectionTestSource, /integrationId/);
  assert.match(connectionTestSource, /eq\("id", integrationId\)/);
  assert.match(connectionTestSource, /status: "needs_attention", last_tested_at: null, last_test_status: null/);
  assert.match(resendTestSource, /requestedConnectionId/);
  assert.match(resendTestSource, /eq\("id", requestedConnectionId\)/);
});


test("the Integrations directory exposes all 122 executable nodes separately from 100 provider entries", () => {
  assert.match(catalogRouteSource, /getExecutableNodeCatalog/);
  assert.match(catalogRouteSource, /getPublicNodeCatalog/);
  assert.match(directorySource, /catalogData\.executableNodes/);
  assert.match(directorySource, /setProviders\(catalogData\.nodes\)/);
  assert.match(directorySource, /Node registry/);
  assert.match(directorySource, /Provider catalogue/);
  assert.match(registrySource, /export function getExecutableNodeCatalog\(\)/);
});

test("every authenticated registry node opens its own provider or Google product connection experience", () => {
  assert.ok(directorySource.includes("/dashboard/connections?provider="));
  assert.ok(directorySource.includes("/dashboard/connections?googleProduct="));
  assert.ok(connectionsSource.includes("setFocusedProvider"));
  assert.ok(connectionsSource.includes("focusedGoogleProduct"));
  assert.ok(connectionsSource.includes("googleStartHref"));
  assert.ok(connectionsSource.includes("item.provider === focusedProvider"));
});

test("workflow node configuration stores a connection ID, never a credential, and exposes a provider-filtered selector", () => {
  assert.ok(builderSource.includes("Workspace connection"));
  assert.ok(builderSource.includes("connectionId: event.target.value || undefined"));
  assert.ok(builderSource.includes("compatibleConnections"));
  assert.match(builderSource, /workspaceConnections\.filter\(item => item\.provider === provider\)/);
  assert.match(builderSource, /googleConnections\.filter\(item => item\.product === googleProduct\)/);
  assert.match(nodeTypesSource, /resolveStepCredentials\?/);
  assert.match(stepValidatorSource, /selected connection must be a valid connection ID/);
  assert.match(workerSource, /resolveStepCredentials = async/);
});

test("Google OAuth setup is node-specific, multi-account aware, and has lifecycle verification/revocation", () => {
  for (const product of ["gmail", "sheets", "drive", "calendar", "docs", "forms", "youtube", "contacts"]) {
    assert.ok(googleStartSource.includes(product));
    assert.ok(googleConnectionsSource.includes(product) || googleStartSource.includes(product));
  }
  assert.match(googleStartSource, /select_account consent/);
  assert.match(googleStartSource, /aivanta_google_oauth_node/);
  assert.match(googleCallbackSource, /aivanta_google_oauth_node/);
  assert.match(googleConnectionsSource, /export async function POST/);
  assert.match(googleConnectionsSource, /openidconnect\.googleapis\.com\/v1\/userinfo/);
  assert.match(googleConnectionsSource, /hasOnlyApprovedGoogleScopes/);
  assert.match(googleConnectionsSource, /oauth2\.googleapis\.com\/revoke/);
  assert.match(googleConnectionsSource, /export async function DELETE/);
  assert.match(googleStartSource, /connectionId/);
  assert.match(googleCallbackSource, /targetConnectionId/);
  assert.match(googleCallbackSource, /\.eq\("id", targetConnectionId\).*\.eq\("workspace_id", workspace\.id\)/);
  assert.match(genericOAuthStateSource, /connectionId\?: string/);
  assert.match(genericOAuthStartSource, /createOAuthState\(\{ provider, workspaceId: workspace\.id, userId: user\.id, \...\(connectionId \? \{ connectionId \} : \{\}\) \}\)/);
  assert.match(genericOAuthCallbackSource, /p_connection_id: stateData\.connectionId \?\? null/);
  assert.match(googleConnectionsSource, /\.eq\("workspace_id", workspace\.id\)/);
  assert.doesNotMatch(googleConnectionsSource.slice(googleConnectionsSource.indexOf("export async function GET"), googleConnectionsSource.indexOf("const uuidPattern")), /connected_by/);
});

test("cross-workspace account IDs fail closed for saves, tests, disconnects and live execution", () => {
  assert.match(multiAccountMigration, /where id = p_connection_id\s+and workspace_id = p_workspace_id\s+and provider = p_provider/);
  assert.match(multiAccountMigration, /wm\.role in \('owner','admin'\)/);
  assert.match(multiAccountMigration, /revoke all on function public\.save_workspace_integration_connection[\s\S]*from public, anon, authenticated/);
  assert.match(multiAccountMigration, /grant execute on function public\.save_workspace_integration_connection[\s\S]*to service_role/);
  assert.match(connectionTestSource, /eq\("id", integrationId\)[\s\S]*eq\("workspace_id", workspace\.id\)/);
  assert.match(googleConnectionsSource, /eq\("id", connectionId\)\.eq\("workspace_id", workspace\.id\)/);
  assert.match(workerSource, /eq\("workspace_id", workspaceId\)/);
  assert.match(workerSource, /eq\("integration_id", integration\.id\)/);
  assert.match(workflowActivationSource, /eq\("workspace_id", candidate\.workspace_id\)/);
});

test("activation requires workspace-owned Gemini and Resend accounts with passed provider checks", () => {
  assert.match(workflowActivationSource, /selected\.step\?\.connectionId/);
  assert.match(workflowActivationSource, /selected\.provider/);
  assert.match(workflowActivationSource, /connection\.status !== "connected" \|\| connection\.last_test_status !== "passed"/);
});
