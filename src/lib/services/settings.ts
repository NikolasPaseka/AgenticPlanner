import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import type { Actor } from "./actor";
import { ValidationError } from "./errors";

export type AppSettings = typeof appSettings.$inferSelect;

/** Returns the single settings row, creating it with defaults on first use. */
export async function getAppSettings(db: Db): Promise<AppSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  if (row) return row;
  await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
  const [created] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  return created;
}

/** The global agents switch. Only the owner can flip it. */
export async function setAgentsEnabled(db: Db, enabled: boolean, actor: Actor): Promise<AppSettings> {
  if (actor.kind !== "owner") throw new ValidationError("Only the owner can switch agents");
  await getAppSettings(db);
  const [row] = await db
    .update(appSettings)
    .set({
      agentsEnabled: enabled,
      agentsPausedAt: enabled ? null : sql`now()`,
      agentsPausedBy: enabled ? null : actor.name,
      updatedAt: sql`now()`,
    })
    .where(eq(appSettings.id, 1))
    .returning();
  return row;
}
