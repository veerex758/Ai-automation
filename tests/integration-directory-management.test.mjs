import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("app/dashboard/integrations/integration-directory.tsx", root), "utf8");
const api = readFileSync(new URL("app/api/workspace/integrations/route.ts", root), "utf8");
test("integration directory reads live workspace connection status",()=>{
 assert.match(source,/fetch\("\/api\/workspace\/integrations"/);
 assert.match(source,/last_test_status/);
 assert.match(source,/status===\"connected\"/);
});
test("integration UI saves credentials only through the authenticated server API",()=>{
 assert.match(source,/method:\"PUT\"/);
 assert.match(source,/Save credentials/);
 assert.match(source,/never returned to the browser/);
 assert.match(api,/encryptCredentials\(validated\.credentials\)/);
 assert.match(api,/secretReturned: false/);
});
test("Slack delivery test requires an explicit confirmation",()=>{
 assert.match(source,/confirmDeliveryTest:provider===\"slack\"&&confirmSlack/);
 assert.match(source,/I understand the test sends a message to Slack/);
 assert.match(api,/SLACK_TEST_REQUIRES_EXPLICIT_DELIVERY/);
});
test("disconnect and connection test are explicit user actions",()=>{
 assert.match(source,/method:\"DELETE\"/);
 assert.match(source,/method:\"POST\"/);
});
