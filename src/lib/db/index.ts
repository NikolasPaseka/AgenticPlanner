import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";

/** Any Drizzle Postgres database with our schema: Neon, node-postgres, or PGlite (tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function isLocal(url: string) {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Local Postgres (or `npm run db:local`) uses node-postgres; Neon uses its WebSocket pool,
  // which supports interactive transactions on Vercel.
  if (isLocal(url)) {
    return drizzlePg({ client: new PgPool({ connectionString: url, max: 1 }), schema });
  }
  return drizzleNeon({ client: new NeonPool({ connectionString: url }), schema });
}

const globalForDb = globalThis as unknown as { agentPlannerDb?: Db };

/** Lazily created so builds without DATABASE_URL still succeed. */
export function getDb(): Db {
  globalForDb.agentPlannerDb ??= createDb();
  return globalForDb.agentPlannerDb;
}

export { schema };
