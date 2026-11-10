import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { logOperationalEvent } from "../lib/observability/safe-log.cjs";

const listPath = fileURLToPath(new URL("../app/api/activity/route.ts", import.meta.url));
const detailPath = fileURLToPath(new URL("../app/api/activity/[runId]/route.ts", import.meta.url));
const helperPath = fileURLToPath(new URL("../lib/observability/safe-log.cjs", import.meta.url));

const [listRoute, detailRoute, helper] = await Promise.all([
  readFile(listPath, "utf8"),
  readFile(detailPath, "utf8"),
  readFile(helperPath, "utf8"),
]);

test("activity API catch blocks never log raw exceptions", () => {
  for (const route of [listRoute, detailRoute]) {
    assert.match(route, /catch\s*\{/);
    assert.doesNotMatch(route, /console\.(error|warn|log)\s*\(/);
    assert.match(route, /logOperationalEvent\(/);
    assert.doesNotMatch(route, /catch\s*\(error\)[\s\S]{0,180}error\s*\)/);
  }
});

test("activity failures use reviewed stable event and error codes only", () => {
  assert.match(listRoute, /event: "activity_list"/);
  assert.match(listRoute, /errorCode: "ACTIVITY_LIST_FAILED"/);
  assert.match(detailRoute, /event: "activity_run_detail"/);
  assert.match(detailRoute, /errorCode: "ACTIVITY_RUN_DETAIL_FAILED"/);
  assert.match(helper, /"activity_list"/);
  assert.match(helper, /"activity_run_detail"/);
  assert.match(helper, /"ACTIVITY_LIST_FAILED"/);
  assert.match(helper, /"ACTIVITY_RUN_DETAIL_FAILED"/);
});

test("safe logger keeps allowlisted activity metadata and drops exception/sensitive payloads", () => {
  let output = "";
  const caughtError = new Error("postgres connection string and private row details");
  logOperationalEvent({
    event: "activity_list",
    route: "/api/activity",
    outcome: "failure",
    statusCode: 500,
    errorCode: "ACTIVITY_LIST_FAILED",
    error: caughtError,
    exception: caughtError,
    userId: "private-user-id",
    workspaceId: "private-workspace-id",
    sql: "select * from private_table",
    token: "secret-token",
    providerPayload: { authorization: "Bearer secret" },
  }, (line) => { output = line; });

  const record = JSON.parse(output);
  assert.equal(record.event, "activity_list");
  assert.equal(record.route, "/api/activity");
  assert.equal(record.outcome, "failure");
  assert.equal(record.statusCode, 500);
  assert.equal(record.errorCode, "ACTIVITY_LIST_FAILED");
  for (const field of ["error", "exception", "userId", "workspaceId", "sql", "token", "providerPayload"]) {
    assert.equal(field in record, false, `unexpected sensitive field: ${field}`);
  }
  assert.equal(output.includes("postgres connection string"), false);
  assert.equal(output.includes("private-user-id"), false);
  assert.equal(output.includes("secret-token"), false);
});

test("safe logger rejects unreviewed activity event names and error codes", () => {
  assert.throws(() => logOperationalEvent({ event: "activity_admin_dump" }, () => {}), /event name is invalid/);

  let output = "";
  logOperationalEvent({
    event: "activity_run_detail",
    route: "/api/activity/run-detail",
    errorCode: "DATABASE_PASSWORD_LEAK",
  }, (line) => { output = line; });
  assert.equal("errorCode" in JSON.parse(output), false);
});
