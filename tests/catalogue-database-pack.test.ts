/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { findNode, findOperation } from "../nodes/registry";

const logger = { info() {}, error() {} };
function context(credentials: Record<string, Record<string, string>>, respond: (args: any) => { status: number; body: unknown }) {
  return {
    credentials, logger, previousOutputs: {},
    http: { async request(args: any) { return respond(args); } },
  };
}

test("database and storage providers expose explicit bounded read operations", () => {
  const expected: Record<string, string[]> = {
    supabase: ["execute", "get_row"],
    postgresql: ["execute", "get_database_info"],
    redis: ["execute", "get_many"],
    firebase: ["execute", "get_document"],
    dropbox: ["execute", "get_file_metadata"],
    aws_s3: ["execute", "get_object_metadata"],
    cloudflare_r2: ["execute", "get_object_metadata"],
  };
  for (const [provider, operations] of Object.entries(expected)) {
    const node = findNode(provider);
    assert.ok(node, provider + " must be registered");
    assert.deepEqual(node.actions.map(action => action.id), operations);
    for (const action of node.actions) {
      assert.ok(action.inputSchema && action.outputSchema && typeof action.run === "function");
    }
  }
});

test("Supabase get_row uses HTTPS PostgREST exact equality and one-row cap", async () => {
  let args: any;
  const op = findOperation("supabase", "get_row", "action");
  assert.ok(op);
  const result = await op.run(context({ supabase: { projectUrl: "https://project.supabase.co", apiKey: "publishable-test-key" } }, request => {
    args = request; return { status: 200, body: [{ id: 7, name: "Ada" }] };
  }), { table: "contacts", column: "id", value: "7" });
  const url = new URL(args.url);
  assert.equal(args.method, "GET");
  assert.equal(url.pathname, "/rest/v1/contacts");
  assert.equal(url.searchParams.get("id"), "eq.7");
  assert.equal(url.searchParams.get("limit"), "1");
  assert.equal(result.row.id, 7);
  await assert.rejects(() => op.run(context({ supabase: { projectUrl: "http://project.supabase.co", apiKey: "x" } }, () => { throw new Error("network must not run"); }), { table: "contacts", column: "id", value: "7" }), /SUPABASE_CONNECTION_INVALID/);
});

test("PostgreSQL rejects mutations, comments and multi-statement SQL before connecting", async () => {
  const op = findOperation("postgresql", "execute", "action");
  assert.ok(op);
  const ctx = context({ postgresql: { connectionString: "postgresql://readonly:secret@db.example.test/app?sslmode=require" } }, () => { throw new Error("HTTP must not be used"); });
  await assert.rejects(() => op.run(ctx, { query: "DELETE FROM contacts", parameters: [] }), /POSTGRESQL_READ_ONLY_QUERY_REQUIRED/);
  await assert.rejects(() => op.run(ctx, { query: "SELECT 1; DROP TABLE contacts", parameters: [] }), /POSTGRESQL_READ_ONLY_QUERY_REQUIRED/);
  await assert.rejects(() => op.run(ctx, { query: "SELECT 1 -- comment", parameters: [] }), /POSTGRESQL_READ_ONLY_QUERY_REQUIRED/);
  const info = findOperation("postgresql", "get_database_info", "action");
  assert.ok(info);
  await assert.rejects(() => info.run(context({}, () => { throw new Error("network must not run"); }), {}), /POSTGRESQL_CONNECTION_REQUIRED/);
});

test("Redis get_many sends only MGET and validates one value per key", async () => {
  let args: any;
  const op = findOperation("redis", "get_many", "action");
  assert.ok(op);
  const result = await op.run(context({ redis: { restUrl: "https://example.upstash.io", token: "redis-token" } }, request => {
    args = request; return { status: 200, body: { result: ["one", null] } };
  }), { keys: ["a", "b"] });
  assert.equal(args.method, "POST");
  assert.deepEqual(args.body, ["MGET", "a", "b"]);
  assert.deepEqual(result, { values: [{ key: "a", value: "one" }, { key: "b", value: null }] });
  await assert.rejects(() => op.run(context({ redis: { restUrl: "https://evil.example", token: "x" } }, () => { throw new Error("network must not run"); }), { keys: ["a"] }), /REDIS_CONNECTION_INVALID/);
});

test("Firebase get_document validates the document path and normalizes the result", async () => {
  let args: any;
  const op = findOperation("firebase", "get_document", "action");
  assert.ok(op);
  const result = await op.run(context({ firebase: { projectId: "aivanta-demo1", accessToken: "firebase-token" } }, request => {
    args = request; return { status: 200, body: { name: "projects/aivanta-demo1/databases/(default)/documents/contacts/7", fields: { name: { stringValue: "Ada" } } } };
  }), { documentPath: "contacts/7" });
  assert.match(args.url, /documents\/contacts\/7$/);
  assert.deepEqual(result, { name: "projects/aivanta-demo1/databases/(default)/documents/contacts/7", fields: { name: { stringValue: "Ada" } } });
  await assert.rejects(() => op.run(context({ firebase: { projectId: "aivanta-demo1", accessToken: "x" } }, () => { throw new Error("network must not run"); }), { documentPath: "../secrets" }), /invalid_string|Invalid/);
});

test("Dropbox get_file_metadata calls metadata endpoint without downloading file content", async () => {
  let args: any;
  const op = findOperation("dropbox", "get_file_metadata", "action");
  assert.ok(op);
  const result = await op.run(context({ dropbox: { accessToken: "dropbox-token" } }, request => {
    args = request; return { status: 200, body: { id: "id:abc", name: "report.csv", path_display: "/reports/report.csv", size: 42, content: "must not be exposed" } };
  }), { path: "id:abc" });
  assert.equal(args.url, "https://api.dropboxapi.com/2/files/get_metadata");
  assert.equal(args.method, "POST");
  assert.deepEqual(args.body, { path: "id:abc", include_media_info: false });
  assert.deepEqual(result, { id: "id:abc", name: "report.csv", path: "/reports/report.csv", size: 42 });
});

test("AWS S3 get_object_metadata uses SigV4 and returns metadata only for an exact key", async () => {
  let args: any;
  const op = findOperation("aws_s3", "get_object_metadata", "action");
  assert.ok(op);
  const result = await op.run(context({ aws_s3: { region: "eu-west-1", accessKeyId: "AKIATEST", secretAccessKey: "secret" } }, request => {
    args = request; return { status: 200, body: "<ListBucketResult><Contents><Key>reports/a.csv</Key><LastModified>2026-11-01T00:00:00Z</LastModified><ETag>&quot;abc&quot;</ETag><Size>12</Size></Contents></ListBucketResult>" };
  }), { bucket: "aivanta-data", key: "reports/a.csv" });
  assert.equal(args.method, "GET");
  assert.match(args.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIATEST\//);
  assert.equal(new URL(args.url).searchParams.get("max-keys"), "1");
  assert.deepEqual(result, { key: "reports/a.csv", size: 12, lastModified: "2026-11-01T00:00:00Z", etag: '"abc"' });
  await assert.rejects(() => op.run(context({ aws_s3: { region: "eu-west-1", accessKeyId: "x", secretAccessKey: "y" } }, () => ({ status: 200, body: "<ListBucketResult><Contents><Key>other</Key></Contents></ListBucketResult>" })), { bucket: "aivanta-data", key: "reports/a.csv" }), /AWS_S3_OBJECT_NOT_FOUND/);
});

test("Cloudflare R2 get_object_metadata signs against account endpoint and exposes metadata only", async () => {
  let args: any;
  const op = findOperation("cloudflare_r2", "get_object_metadata", "action");
  assert.ok(op);
  const accountId = "a".repeat(32);
  const result = await op.run(context({ cloudflare_r2: { accountId, accessKeyId: "R2ACCESS", secretAccessKey: "r2secret" } }, request => {
    args = request; return { status: 200, body: "<ListBucketResult><Contents><Key>images/logo.svg</Key><LastModified>2026-11-02T00:00:00Z</LastModified><ETag>etag1</ETag><Size>88</Size></Contents></ListBucketResult>" };
  }), { bucket: "assets", key: "images/logo.svg" });
  assert.match(args.url, new RegExp(accountId + "\\.r2\\.cloudflarestorage\\.com"));
  assert.match(args.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=R2ACCESS\//);
  assert.deepEqual(result, { key: "images/logo.svg", size: 88, lastModified: "2026-11-02T00:00:00Z", etag: "etag1" });
});

test("all database provider operations fail closed when workspace credentials are missing", async () => {
  const cases: Array<[string, string, unknown]> = [
    ["supabase", "get_row", { table: "contacts", column: "id", value: "1" }],
    ["postgresql", "get_database_info", {}],
    ["redis", "get_many", { keys: ["one"] }],
    ["firebase", "get_document", { documentPath: "contacts/1" }],
    ["dropbox", "get_file_metadata", { path: "id:1" }],
    ["aws_s3", "get_object_metadata", { bucket: "aivanta-data", key: "file.txt" }],
    ["cloudflare_r2", "get_object_metadata", { bucket: "assets", key: "file.txt" }],
  ];
  for (const [provider, operationId, input] of cases) {
    const op = findOperation(provider, operationId, "action");
    assert.ok(op, provider + "." + operationId);
    await assert.rejects(() => op.run(context({}, () => { throw new Error("network must not run"); }), input), new RegExp(provider.toUpperCase() + "_CONNECTION_REQUIRED"));
  }
});
