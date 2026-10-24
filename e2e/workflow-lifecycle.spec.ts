import { test, expect } from "@playwright/test";

const baseURL = process.env.AIVANTA_E2E_BASE_URL;
const email = process.env.AIVANTA_E2E_EMAIL;
const password = process.env.AIVANTA_E2E_PASSWORD;

test.describe("authenticated workflow lifecycle", () => {
  test.skip(
    !baseURL || !email || !password,
    "Set AIVANTA_E2E_BASE_URL, AIVANTA_E2E_EMAIL, and AIVANTA_E2E_PASSWORD to run against an authorized non-production preview.",
  );

  let createdWorkflowId: string | undefined;

  test.beforeEach(async ({ page }) => {
    const target = new URL(baseURL!);
    const isProductionAlias = target.hostname === "ai-automation-veerex-org.vercel.app";
    const looksLikePreview = /(^|[-.])(preview|staging)([-.]|$)/i.test(target.hostname)
      || target.hostname.includes("-git-");
    if (target.protocol !== "https:" || isProductionAlias || !looksLikePreview) {
      throw new Error("Refusing authenticated E2E mutations: AIVANTA_E2E_BASE_URL must be an approved HTTPS preview/staging host, not production.");
    }

    await page.goto("/login");
    await page.getByLabel("Email address").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: /sign in to workspace/i }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
  });

  test.afterEach(async ({ page }) => {
    if (!createdWorkflowId) return;
    // Only delete the unique workflow created by this test. Never clean up by broad query.
    await page.evaluate(async (id) => {
      await fetch(`/api/workflows/${id}`, { method: "DELETE", headers: { Accept: "application/json" } });
    }, createdWorkflowId);
    createdWorkflowId = undefined;
  });

  test("signs in, creates a workflow, saves/reloads its definition, and persists active status", async ({ page }) => {
    const workflowName = `Aivanta E2E ${Date.now()}`;

    await page.getByRole("button", { name: /new workflow/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("Workflow name").fill(workflowName);
    await page.getByLabel("Description").fill("Disposable authenticated lifecycle test; no external actions.");
    await page.getByRole("button", { name: /create draft/i }).click();

    const workflowRow = page.locator(".workflow-row").filter({ hasText: workflowName });
    await expect(workflowRow).toBeVisible();
    await workflowRow.getByRole("button", { name: `Workflow actions for ${workflowName}` }).click();
    await workflowRow.getByRole("link", { name: /open builder/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/workflows\/[0-9a-f-]+/i);

    const match = page.url().match(/\/dashboard\/workflows\/([0-9a-f-]+)/i);
    expect(match, "workflow builder URL should contain a workflow UUID").not.toBeNull();
    createdWorkflowId = match![1];

    const stepName = page.getByLabel("Step name");
    await expect(stepName).toBeVisible();
    await stepName.fill("E2E persisted trigger");
    await page.getByRole("button", { name: /save workflow/i }).click();
    await expect(page.getByRole("status")).toContainText(/workflow saved as version/i);

    await page.reload();
    await expect(page.getByLabel("Step name")).toHaveValue("E2E persisted trigger");

    // The current API supports a persisted active status, but the UI does not yet
    // offer an Activate control or configure schedule rows. This asserts status
    // persistence only; it does NOT claim the workflow will run automatically.
    const activation = await page.evaluate(async (id) => {
      const response = await fetch(`/api/workflows/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      return { status: response.status, body: await response.json() };
    }, createdWorkflowId);
    expect(activation.status).toBe(200);
    expect(activation.body.workflow.status).toBe("Active");

    await page.reload();
    await expect(page.locator(".builder-draft")).toContainText(/active/i);
  });
});
