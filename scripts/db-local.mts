/**
 * Runs an embedded Postgres (PGlite) on localhost for local development and
 * end-to-end tests, so you can work without a Neon database. Migrations in
 * ./drizzle are applied on start.
 *
 *   npm run db:local
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54320/postgres npm run dev
 *
 * Env: PGLITE_PORT (default 54320, so it does not clash with an installed Postgres),
 * PGLITE_DIR (default ./.pglite; "memory://" for a throwaway database).
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const port = Number(process.env.PGLITE_PORT ?? 54320);
const dataDir = process.env.PGLITE_DIR ?? "./.pglite";
const db = await PGlite.create(dataDir);
await migrate(drizzle({ client: db }), { migrationsFolder: "drizzle" });

// PGlite runs queries one at a time; the server queues them, so several clients can connect.
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 20 });
await server.start();
console.log(`PGlite ready (${dataDir}): postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
