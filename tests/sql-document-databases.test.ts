import test from "node:test";
import assert from "node:assert/strict";
import { createSqlDocumentDatabaseNodes } from "../nodes/sql-document-databases";
import type { NodeContext } from "../nodes/types";

const logger = { info() {}, error() {} };
function context(credentials: Record<string, Record<string, string>>): NodeContext {
  return { credentials, logger, previousOutputs: {}, http: { async request() { throw new Error("HTTP must not be used"); } } };
}

test("MySQL executes a parameterized SELECT in a read-only transaction and caps results", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let began = false, committed = false, closed = false, rolledBack = false;
  const [mysql] = createSqlDocumentDatabaseNodes({
    async connectMysql(uri) {
      assert.equal(uri, "mysql://worker:secret@db.example.test/app");
      return {
        async query(sql, values) {
          calls.push({ sql, values });
          if (sql.startsWith("SET TRANSACTION")) return [[], []];
          return calls.length === 1 ? [[], []] : [[{ id: 1 }, { id: 2 }, { id: 3 }], []];
        },
        async beginTransaction() { began = true; },
        async commit() { committed = true; },
        async rollback() { rolledBack = true; },
        async end() { closed = true; },
      };
    },
    async connectMongo() { throw new Error("Mongo must not be used"); },
  });
  const result = await mysql.actions[0].run(context({ mysql: { connectionString: "mysql://worker:secret@db.example.test/app" } }), {
    query: "SELECT id FROM contacts WHERE email = ?",
    parameters: ["a@example.test"],
    limit: 2,
  }) as { rows: unknown[]; rowCount: number };
  assert.equal(began, true);
  assert.equal(committed, true);
  assert.equal(rolledBack, false);
  assert.equal(closed, true);
  assert.match(calls[0].sql, /READ ONLY/);
  assert.match(calls[1].sql, /LIMIT \?/);
  assert.deepEqual(calls[1].values, ["a@example.test", 2]);
  assert.equal(result.rowCount, 2);
  assert.deepEqual(result.rows, [{ id: 1 }, { id: 2 }]);
});

test("MySQL rolls back failed queries and always closes the driver", async () => {
  let rolledBack = false, closed = false;
  const [mysql] = createSqlDocumentDatabaseNodes({
    async connectMysql() {
      return {
        async query(sql) { if (sql.startsWith("SELECT")) throw new Error("query failed"); return [[], []]; },
        async beginTransaction() {},
        async commit() {},
        async rollback() { rolledBack = true; },
        async end() { closed = true; },
      };
    },
    async connectMongo() { throw new Error("Mongo must not be used"); },
  });
  await assert.rejects(() => mysql.actions[0].run(context({ mysql: { connectionString: "mysql://worker:secret@db.example.test/app" } }), {
    query: "SELECT id FROM contacts", parameters: [], limit: 5,
  }), /query failed/);
  assert.equal(rolledBack, true);
  assert.equal(closed, true);
});

test("MySQL rejects non-read-only SQL and malformed connection strings", async () => {
  const [mysql] = createSqlDocumentDatabaseNodes();
  const ctx = context({ mysql: { connectionString: "mysql://worker:secret@db.example.test/app" } });
  await assert.rejects(() => mysql.actions[0].run(ctx, { query: "DELETE FROM contacts", parameters: [], limit: 1 }), /MYSQL_READ_ONLY_QUERY_REQUIRED/);
  await assert.rejects(() => mysql.actions[0].run(ctx, { query: "SELECT 'secret' INTO DUMPFILE '/tmp/leak'", parameters: [], limit: 1 }), /MYSQL_READ_ONLY_QUERY_REQUIRED/);
  await assert.rejects(() => mysql.actions[0].run(context({ mysql: { connectionString: "https://example.test" } }), { query: "SELECT 1", parameters: [], limit: 1 }), /MYSQL_CONNECTION_INVALID/);
});

test("MongoDB uses a real driver adapter, validates equality filters, caps results and closes", async () => {
  let observed: { collection: string; filter: Record<string, unknown>; limit: number } | undefined;
  let closed = false;
  const [, mongo] = createSqlDocumentDatabaseNodes({
    async connectMysql() { throw new Error("MySQL must not be used"); },
    async connectMongo(uri) {
      assert.equal(uri, "mongodb://worker:secret@db.example.test/app");
      return {
        async find(collection, filter, limit) { observed = { collection, filter, limit }; return [{ id: 1 }, { id: 2 }, { id: 3 }]; },
        async close() { closed = true; },
      };
    },
  });
  const result = await mongo.actions[0].run(context({ mongodb: { connectionString: "mongodb://worker:secret@db.example.test/app" } }), {
    collection: "contacts", filter: { status: "new" }, limit: 2,
  }) as { documents: unknown[]; count: number };
  assert.deepEqual(observed, { collection: "contacts", filter: { status: "new" }, limit: 2 });
  assert.equal(closed, true);
  assert.equal(result.count, 2);
  assert.deepEqual(result.documents, [{ id: 1 }, { id: 2 }]);
  await assert.rejects(() => mongo.actions[0].run(context({ mongodb: { connectionString: "mongodb://worker:secret@db.example.test/app" } }), {
    collection: "contacts", filter: { "$where": "evil" }, limit: 2,
  }), /MONGODB_FILTER_INVALID/);
  const pollutedInput = JSON.parse('{"__proto__":{"polluted":true}}');
  try {
    await mongo.actions[0].run(context({ mongodb: { connectionString: "mongodb://worker:secret@db.example.test/app" } }), {
      collection: "contacts", filter: pollutedInput, limit: 2,
    });
  } catch (error) {
    assert.ok(error instanceof Error);
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
