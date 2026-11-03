import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const approved = {
  "@googleapis/gmail": "22.0.2",
  "@googleapis/sheets": "18.1.2",
  "@slack/web-api": "8.2.0",
  "@notionhq/client": "5.28.0",
  "@hubspot/api-client": "14.0.1",
  "twilio": "6.2.0",
  "@shopify/shopify-api": "15.0.1",
  "stripe": "23.0.1",
  "resend": "6.37.0",
  "@linear/sdk": "100.0.0",
};

test("ten approved integration SDKs are pinned to exact versions", () => {
  for (const [name, version] of Object.entries(approved)) {
    assert.equal(pkg.dependencies[name], version, `${name} must remain pinned to ${version}`);
    assert.equal(pkg.dependencies[name].startsWith("^") || pkg.dependencies[name].startsWith("~"), false);
  }
});

test("Aivanta does not add n8n runtime packages as executable dependencies", () => {
  assert.equal(
    Object.keys(pkg.dependencies).some((name) => name === "n8n" || name.startsWith("n8n-nodes-")),
    false,
  );
});
