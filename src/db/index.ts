import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * The database is created lazily, on first use.
 *
 * Throwing at import time breaks `next build`: Next.js imports every route
 * module while collecting page data, and on Vercel DATABASE_URL may not be
 * set (e.g. when the app runs in Supabase mode). Now the error is only raised
 * if code actually tries to query the local database at runtime.
 */

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: NodePgDatabase;
};

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Local databases connect without TLS. Remote ones (Supabase) use TLS.
 * Supabase's certificate chain is not in Node's default trust store, so either
 * provide its CA in DATABASE_CA_CERT (Supabase -> Database -> SSL), or the
 * connection is encrypted without verifying the certificate.
 * sslmode is removed from the URL because pg would let it override `ssl`.
 */
function connectionConfig(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const sslMode = url.searchParams.get("sslmode");
  if (isLocal || sslMode === "disable") {
    return { connectionString: databaseUrl };
  }

  url.searchParams.delete("sslmode");
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  return {
    connectionString: url.toString(),
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  };
}

export function getPool(): Pool {
  if (globalForDb.__arenaNextJsPostgresqlPool) {
    return globalForDb.__arenaNextJsPostgresqlPool;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ ...connectionConfig(databaseUrl), max: 5 });
  // Cache in every environment so serverless invocations reuse one pool.
  globalForDb.__arenaNextJsPostgresqlPool = pool;
  return pool;
}

export function getDb(): NodePgDatabase {
  if (!globalForDb.__arenaNextJsPostgresqlDb) {
    globalForDb.__arenaNextJsPostgresqlDb = drizzle(getPool());
  }
  return globalForDb.__arenaNextJsPostgresqlDb;
}

/** Drop-in `db` export: connects on first property access, not on import. */
export const db: NodePgDatabase = new Proxy({} as NodePgDatabase, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
