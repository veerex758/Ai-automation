import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { createSqlDocumentDatabaseNodes } from "../nodes/sql-document-databases";
import type { NodeContext } from "../nodes/types";

const mysqlUrl = process.env.MYSQL_TEST_URL;
const mongoUrl = process.env.MONGODB_TEST_URL;
const [mysqlNode, mongoNode] = createSqlDocumentDatabaseNodes();
const mysqlQuery = mysqlNode.actions.find((operation) => operation.id === "query");
const mongoFind = mongoNode.actions.find((operation) => operation.id === "find");

function context(): NodeContext {
  if (!mysqlUrl || !mongoUrl) throw new Error("Database integration URLs are required");
  return {
    credentials: { mysql: { connectionString: mysqlUrl }, mongodb: { connectionString: mongoUrl } },
    logger: { info() {}, error() {} },
    http: { async request() { throw new Error("HTTP is unavailable in database integration tests"); } },
    previousOutputs: {},
  };
}

test("real MySQL driver executes a parameterized SELECT over verified TLS", {
  skip: mysqlUrl ? false : "MYSQL_TEST_URL is not configured",
}, async () => {
  assert.ok(mysqlQuery);
  const result = await mysqlQuery.run(context(), { query: "SELECT ? AS answer", parameters: [42], limit: 1 }) as {
    rows: Array<Record<string, unknown>>; rowCount: number;
  };
  assert.equal(result.rowCount, 1);
  assert.equal(Number(result.rows[0]?.answer), 42);
});

test("real MongoDB driver reads an authenticated TLS collection with a bounded filter", {
  skip: mongoUrl ? false : "MONGODB_TEST_URL is not configured",
}, async () => {
  assert.ok(mongoUrl && mongoFind);
  const client = new MongoClient(mongoUrl, { tls: true, tlsAllowInvalidCertificates: false, serverSelectionTimeoutMS: 5000 });
  const collection = "aivanta_ci_" + randomUUID().replace(/-/g, "");
  const marker = randomUUID();
  try {
    await client.connect();
    await client.db().collection(collection).insertOne({ marker, status: "ready" });
    const result = await mongoFind.run(context(), { collection, filter: { marker }, limit: 1 }) as {
      documents: Array<Record<string, unknown>>; count: number;
    };
    assert.equal(result.count, 1);
    assert.equal(result.documents[0]?.marker, marker);
  } finally {
    try { await client.db().collection(collection).drop(); } catch { /* test cleanup */ }
    await client.close();
  }
});
