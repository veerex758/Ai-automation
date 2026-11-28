import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const playbookPage = readFileSync(new URL("../app/dashboard/playbooks/new/page.tsx", import.meta.url), "utf8");
const generationRoute = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
const playbookStyles = readFileSync(new URL("../app/dashboard/playbooks/playbooks.css", import.meta.url), "utf8");

test("real-estate Playbook outcome remains limited to 240 characters and sends no inline technical prompt", () => {
  assert.match(playbookPage, /maxLength=\{240\}/);
  assert.match(playbookPage, /generateDraft\(outcome\.trim\(\), crmProvider\)/);
  assert.match(playbookPage, /prompt:\s*prompt\.trim\(\),\s*starterType:\s*"real_estate",\s*crmProvider:\s*selectedCrmProvider,/);
  assert.doesNotMatch(playbookPage, /const prompt = \[/);
});

test("generation API applies the 240-character real-estate limit and preserves the generic limit", () => {
  assert.match(generationRoute, /const MAX_REAL_ESTATE_OUTCOME_LENGTH = 240;/);
  assert.match(generationRoute, /starterType === "real_estate" \? MAX_REAL_ESTATE_OUTCOME_LENGTH : MAX_PROMPT_LENGTH/);
  assert.match(generationRoute, /Keep the business outcome to \$\{MAX_REAL_ESTATE_OUTCOME_LENGTH\} characters or fewer\./);
  assert.match(generationRoute, /Keep the description to \$\{MAX_PROMPT_LENGTH\} characters or fewer\./);
});

test("Playbook panel headings explicitly reset inherited global letter spacing", () => {
  const headingRule = playbookStyles.match(/\.playbook-panel-heading h2,\.playbook-panel-heading h3\{[^}]*\}/)?.[0];
  assert.ok(headingRule, "Expected a local Playbook panel heading rule.");
  assert.match(headingRule, /letter-spacing:\s*normal/);
});
