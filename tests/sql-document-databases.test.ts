import test from "node:test";
import assert from "node:assert/strict";
import { createSqlDocumentDatabaseNodes } from "../nodes/sql-document-databases";
import type { NodeContext } from "../nodes/types";

const logger = { info() {}, error() {} };
function context(credentials: Record<string, Record<string, string>>): NodeContext {
  return { credentials, logger, previousOutputs: {}, http: { async request() { throw new Error("HTTP must not be used"); } } };
}

test("MySQL uses a real-driver adapter contract, a read-only transaction, bound values and a hard row cap", async () => {
  let executed: { sql: string; values: unknown[] } | undefined;
  let began = false, committed = false, closed = false;
  const [mysql] = createSqlDocumentDatabaseNodes({
    async connectMysql(uri) {
      assert.equal(uri, "mysql://worker:secret@db.example.test/app");
      return {
        async beginTransaction() { began = true; },
        async execute(sql, values) { executed = { sql, values }; return [[{ id: 1 }, { id: 2 }], []]; },
        async commit() { committed = true; },
        async rollback() {},
        async end() { closed = true; },
      };
    },
    async connectMongo() { throw new Error("Mongo must not be used"); },
  });
  const result = await mysql.actions[0].run(context({ mysql: { connectionString: "mysql://worker:secret@db.example.test/app" } }), {
    query: "SELECT id FROM contacts WHERE email = ?",
    parameters: ["a@example.test"],
    limit: 2,
  });
  assert.deepEqual(¶»§q«^