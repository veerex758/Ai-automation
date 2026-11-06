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
const MAX_QUERY_BYTES = 4000;
const mysqlInput = z.object({
  query: z.string().min(7).max(MAX_QUERY_BYTES),
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
    throw new Error¶»§q«^