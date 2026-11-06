import { createConnection } from "mysql2/promise";
import { MongoClient } from "mongodb";
import { z } from "zod";
import type { NodeContext, NodeDefinition } from "./types";

type MysqlSession = {
  beginTransaction(): Promise<void>;
  execute(sql: string, values: unknown[]): Promise<[unknown, unknown]>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  end(): Promise<void>;
};
type MongoSession = {
  find(collection: string, filter: Record<string, unknown>, limit: number): Promise<unknown[]>;
  close(): Promise<void>;
};
type DriverDependencies = {
  connectMysql(uri: string): Promise<MysqlSession>;
  connectMongo(uri: string): Promise<MongoSession>;
};

const MAX_RESULT_ROWS = 100;
const mysqlInput = z.object({
  query: z.string().trim().min(7).max(4000),
  parameters: z.array(z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()])).max(50).default([]),
  limit: z.number().int().min(1).max(MAX_RESULT_ROWS).default(25),
}).strict();
const mongoInput = z.object({
  collection: z.string().regex(/^[A-Za-z_][A-Za-z0-9_$-]{0,119}$/),
  filter: z.record(z.string().max(120), z.unknown()).default({}),
  limit: z.number().int().min(1).max(MAX_RESULT_ROWS).default(25),
}).strict();

function connectionString(ctx: NodeContext, provider: "mysql" | "mongodb"): string {
  const value = ctx.credentials[provider]?.connectionString;
  if (typeof value !== "string" || value.length < 10 || value.length > 4096) {
    throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(provider.toUpperCase() + "_CONNECTION_INVALID"); }
  const allowed = provider === "mysql" ? ["mysql:", "mysql2:"] : ["mongodb:", "mongodb+srv:"];
  if (!allowed.includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.password) {
    throw new Error(provider.toUpperCase() + "_CONNECTION_INVALID");
  }
  return value;
}

function validateReadOnlySql(query: string): string {
  const sql = query.trim().replace(/;\s*$/, "");
  if (!/^select\b/i.test(sql) || /;|--|\/\*|\*\/|\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|set|reset|vacuum|analyze|into\s+outfile|load_file|sleep|benchmark)\b/i.test(sql)) {
    throw new Error("MYSQL_READ_ONLY_QUERY_REQUIRED");
  }
  return sql;
}

function validateMongoFilter(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 5) {
    throw new Error("MONGODB_FILTER_INVALID");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) throw new Error("MONGODB_FILTER_INVALID");
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(key) || key.startsWith("$")) throw new Error("MONGODB_FILTER_INVALID");
    if (item && typeof item === "object") throw new Error("MONGODB_FILTER_INVALID");
    if (typeof item === "string" && item.length > 2000) throw new Error("MONGODB_FILTER_INVALID");
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("MONGODB_FILTER_INVALID");
    if (item !== null && !["string", "number", "boolean"].includes(typeof item)) throw new Error("MONGODB_FILTER_INVALID");
    result[key] = item;
  }
  return result;
}

const defaultDependencies: DriverDependencies = {
  async connectMysql(uri) {
    const url = new URL(uri);
    const connection = await createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")) || undefined,
      ssl: { rejectUnauthorized: true },
      connectTimeout: 5000,
      multipleStatements: false,
    });
    return {
      beginTransaction: () => connection.beginTransaction(),
      execute: (query, values) => connection.execute(query, values),
      commit: () => connection.commit(),
      rollback: () => connection.rollback(),
      end: () => connection.end(),
    };
  },
  async connectMongo(uri) {
    const client = new MongoClient(uri, {
      tls: true,
      tlsAllowInvalidCertificates: false,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 2,
    });
    await client.connect();
    const database = client.db();
    return {
      async find(collection, filter, limit) {
        return database.collection(collection).find(filter).limit(limit).toArray();
      },
      close: () => client.close(),
    };
  },
};

function makeMysqlNode(deps: DriverDependencies): NodeDefinition {
  return {
    id: "mysql", name: "MySQL", icon: "database", category: "data", version: 1,
    auth: { type: "connectionString", credentialKey: "connectionString" },
    triggers: [],
    actions: [{
      id: "query", name: "Run read-only query",
      description: "Runs a parameterized SELECT query in a read-only transaction. Results are capped at 100 rows and connections are always closed.",
      inputSchema: mysqlInput,
      outputSchema: z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(MAX_RESULT_ROWS), rowCount: z.number().int().nonnegative() }).strict(),
      async run(ctx, raw) {
        const input = mysqlInput.parse(raw);
        const sql = validateReadOnlySql(input.query);
        const uri = connectionString(ctx, "mysql");
        const session = await deps.connectMysql(uri);
        let transactionStarted = false;
        try {
          await session.execute("SET TRANSACTION READ ONLY", []);
          await session.beginTransaction();
          transactionStarted = true;
          const bounded = "SELECT * FROM (" + sql + ") AS aivanta_read_only_result LIMIT ?";
          const [rawRows] = await session.execute(bounded, [...input.parameters, input.limit]);
          if (!Array.isArray(rawRows)) throw new Error("MYSQL_INVALID_RESPONSE");
          const rows = rawRows.slice(0, input.limit).filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row));
          await session.commit();
          transactionStarted = false;
          return { rows, rowCount: rows.length };
        } catch (error) {
          if (transactionStarted) {
            try { await session.rollback(); } catch { /* preserve the original database error */ }
          }
          throw error;
        } finally {
          await session.end();
        }
      },
    }],
  };
}

function makeMongoNode(deps: DriverDependencies): NodeDefinition {
  return {
    id: "mongodb", name: "MongoDB", icon: "database", category: "data", version: 1,
    auth: { type: "connectionString", credentialKey: "connectionString" },
    triggers: [],
    actions: [{
      id: "find", name: "Find documents",
      description: "Reads documents matching a bounded equality filter from a workspace MongoDB database over verified TLS. Results are capped at 100 documents.",
      inputSchema: mongoInput,
      outputSchema: z.object({ documents: z.array(z.record(z.string(), z.unknown())).max(MAX_RESULT_ROWS), count: z.number().int().nonnegative() }).strict(),
      async run(ctx, raw) {
        const input = mongoInput.parse(raw);
        const uri = connectionString(ctx, "mongodb");
        const filter = validateMongoFilter(input.filter);
        const session = await deps.connectMongo(uri);
        try {
          const documents = await session.find(input.collection, filter, input.limit);
          const safeDocuments = documents.slice(0, input.limit).filter((doc): doc is Record<string, unknown> => !!doc && typeof doc === "object" && !Array.isArray(doc));
          return { documents: safeDocuments, count: safeDocuments.length };
        } finally {
          await session.close();
        }
      },
    }],
  };
}

export function createSqlDocumentDatabaseNodes(dependencies: Partial<DriverDependencies> = {}): NodeDefinition[] {
  const deps = { ...defaultDependencies, ...dependencies };
  return [makeMysqlNode(deps), makeMongoNode(deps)];
}

export const sqlDocumentDatabaseNodes = createSqlDocumentDatabaseNodes();
