import { Pool } from "pg";

declare global {
  // Reuse a pool across development hot reloads.
  // eslint-disable-next-line no-var
  var aivantaPgPool: Pool | undefined;
}

const connectionString = process.env.DATABASE_URL;

export function getDatabasePool(): Pool {
  if (!connectionString) {
    throw new Error("Database is not configured. Set DATABASE_URL to a PostgreSQL connection string.");
  }

  if (!globalThis.aivantaPgPool) {
    globalThis.aivantaPgPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    });
  }

  return globalThis.aivantaPgPool;
}
