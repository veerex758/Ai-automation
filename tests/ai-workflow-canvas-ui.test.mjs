import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/dashboard/builder/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/dashboard/builder/builder.css", import.meta.url), "utf8");

test("AI-generated workflow preview renders connected, reviewable node cards", () => {
  const previewStart = page.indexOf("{aiPreview && <div className=\"ai-workflow-preview\">");
  const applyStart = page.indexOf(">Apply draft to canvas", previewStart);
  assert.notEqual(previewStart, -1, "generated workflow preview exists");
  assert.notEqual(applyStart, -1, "preview keeps the explicit apply action");
  const preview = page.slice(previewStart, applyStart);

  assert.match(preview, /className="ai-node-canvas"/);
  assert.match(preview, /role="list"/);
  assert.match(preview, /ai-generated-node ai-generated-node-/);
  assert.match(preview, /className="ai-node-connector"/);
  assert.match(preview, /Needs review/);
  assert.match(preview, /ai-node-scroll-hint/);
  assert.doesNotMatch(preview, /Object\.entries\(node\.settings\)/, "raw settings are not printed in the generated preview");
  assert.doesNotMatch(page, /Object\.entries\(node\.settings\)/, "raw settings are not used as fallback canvas labels");
  assert.match(page, /settings: \{ \.\.\.node\.settings \}/, "generated settings are retained when applying the draft");
  assert.doesNotMatch(page, /node\.type === "action" \? \{ settings:/, "settings retention is not limited to action nodes");
});

test("connected preview has positioned connectors and a narrow-screen layout", () => {
  assert.match(styles, /\.ai-node-connector\{position:relative;/);
  assert.match(styles, /\.ai-node-connector:before\{content:"";position:absolute;left:0;top:50%;transform:translateY\(-50%\)/);
  assert.match(styles, /@media\(max-width:640px\)/);
  assert.match(styles, /\.ai-node-scroll-hint\{display:block/);
  assert.match(styles, /\.ai-node-canvas\{[^}]*overflow-x:auto/s);
  assert.match(styles, /\.ai-generated-node:focus-within/);
  assert.match(styles, /\.ai-generated-node-trigger\{border-top:3px solid/);
  assert.match(styles, /\.ai-generated-node-action\{border-top:3px solid/);
  assert.match(styles, /\.ai-generated-node-condition\{border-top:3px solid/);
});
