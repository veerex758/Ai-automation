import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("visual builder uses only dark Rexnora surfaces and approved accents", async () => {
  const css = await read("app/dashboard/builder/builder.css");
  for (const selector of [
    ".builder-content{background:#0B0F14!important",
    ".ai-workflow-panel{background:#1A1F29!important",
    ".flow-canvas{background:#0F141D!important",
    ".canvas-grid{background-color:#0F141D!important",
    ".builder-node{background:#151C27!important",
    ".builder-ai-badge{background:#172846!important",
    ".node-condition{background:#241A3D!important",
  ]) assert.ok(css.includes(selector), "missing Rexnora builder rule: " + selector);
  assert.match(css, /\.builder-primary-button\{background:#F8FAFC!important;color:#0B0F14!important/);
});

test("saved workflow graph editor uses dark canvas, panels and blue/lavender states", async () => {
  const css = await read("app/dashboard/workflows/[workflowId]/builder.css");
  assert.match(css, /\.workflow-builder-main \.graph-canvas\{background:#0F141D!important/);
  assert.match(css, /\.workflow-builder-main \.graph-node\{background:#151C27!important/);
  assert.match(css, /\.workflow-builder-main \.builder-inspector[^}]*background:#1A1F29!important/s);
  assert.match(css, /\.workflow-builder-main \.graph-node-selected[^}]*border-color:#3B82F6!important/s);
});

test("mobile navigation is a compact horizontally scrollable rail in both builder experiences", async () => {
  const [dashboard, builder, saved] = await Promise.all([
    read("app/dashboard/dashboard.css"),
    read("app/dashboard/builder/builder.css"),
    read("app/dashboard/workflows/[workflowId]/builder.css"),
  ]);
  for (const [name, css] of [["dashboard", dashboard], ["builder", builder], ["saved builder", saved]]) {
    assert.match(css, /\.side-nav[^}]*flex-direction:row!important/s, name + " navigation must be horizontal");
    assert.match(css, /\.side-nav[^}]*overflow-x:auto!important/s, name + " navigation must scroll horizontally");
  }
});

test("floating sign-out control follows the Rexnora dark palette", async () => {
  const css = await read("app/dashboard/session.css");
  assert.match(css, /\.session-signout\{background:rgba\(26,31,41,\.96\)!important/);
  assert.match(css, /\.session-signout button\{color:#F8FAFC!important/);
});
