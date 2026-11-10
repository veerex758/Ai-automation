import { test, expect } from "@playwright/test";

const baseUrl = process.env.AIVANTA_E2E_BASE_URL;
test.skip(!baseUrl, "Set AIVANTA_E2E_BASE_URL to run authenticated staging E2E.");

test("authenticated workflow draft save, reload, validate, dry-run and activation gate", async ({ page }) => {
  const email = process.env.AIVANTA_E2E_EMAIL;
  const password = process.env.AIVANTA_E2E_PASSWORD;
  if (!email || !password) throw new Error("AIVANTA_E2E_EMAIL and AIVANTA_E2E_PASSWORD are required when the E2E base URL is configured.");

  const target = new URL(baseUrl!);
  const host = target.hostname.toLowerCase();
  const isPreview = host.includes("staging") || host.includes("preview") || (host.includes("-git-") && !host.includes("-git-main-"));
  if (target.protocol !== "https:" || !isPreview) {
    throw new Error("Authenticated E2E tests may target only an HTTPS staging/preview deployment, never production.");
  }

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 30_000 });
  const api = page.context().request;

  const name = `E2E draft ${Date.now()}`;
  const definition = {
    version: 1,
    nodes: [{
      id: "manual-trigger",
      type: "trigger",
      title: "Manual trigger",
      description: "Start the workflow manually.",
      settings: { event: "manual" },
    }],
  };
  const registrySteps = [{
    id: "manual-trigger",
    nodeId: "manual",
    operationId: "start",
    kind: "trigger",
    input: {},
  }];
  let workflowId: string | undefined;
  try {
    const created = await api.post("/api/workflows", {
      data: { name, description: "Authenticated lifecycle E2E draft.", status: "draft", definition, registrySteps },
    });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    workflowId = createdBody.workflow.id;
    expect(workflowId).toBeTruthy();
    expect(createdBody.workflow.status).toBe("Draft");

    const saved = await api.patch(`/api/workflows/${workflowId}/definition`, {
      data: { definition, registrySteps },
    });
    expect(saved.status()).toBe(200);
    expect((await saved.json()).success).toBe(true);

    const reloaded = await api.get(`/api/workflows/${workflowId}/definition`);
    expect(reloaded.status()).toBe(200);
    const reloadedBody = await reloaded.json();
    expect(reloadedBody.definition.nodes[0].registryNodeId).toBe("manual");
    expect(reloadedBody.definition.nodes[0].registryOperationId).toBe("start");

    const validation = await api.post(`/api/workflows/${workflowId}/definition`, { data: { definition } });
    expect(validation.status()).toBe(200);
    expect((await validation.json()).valid).toBe(true);

    const dryRun = await api.post(`/api/workflows/${workflowId}/registry-run`, { data: { dryRun: true } });
    expect(dryRun.status()).toBe(201);
    const dryRunBody = await dryRun.json();
    expect(dryRunBody.run.status).toBe("succeeded");
    expect(dryRunBody.run.mode).toBe("dry_run");
    expect(dryRunBody.sideEffectsPerformed).toBe(false);

    const activation = await api.patch(`/api/workflows/${workflowId}`, { data: { status: "active" } });
    expect(activation.status()).toBe(422);
    const stillDraft = await api.get(`/api/workflows/${workflowId}/definition`);
    expect((await stillDraft.json()).workflow.status).toBe("draft");
  } finally {
    if (workflowId) {
      const removed = await api.delete(`/api/workflows/${workflowId}`);
      expect([200, 404]).toContain(removed.status());
    }
  }
});
