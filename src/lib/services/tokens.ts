import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { apiTokens, projects } from "@/lib/db/schema";
import type { Actor } from "./actor";
import { NotFoundError, ValidationError } from "./errors";
import type { Project } from "./projects";
import { TOKEN_SCOPES } from "@/lib/scopes";

export { SCOPE_LABEL, TOKEN_SCOPES, type TokenScope } from "@/lib/scopes";

export type ApiToken = typeof apiTokens.$inferSelect;

const TOKEN_PREFIX = "ap_";

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const createInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(50)
    .regex(/^[\w.-]+$/, "Use letters, digits, dot, dash, or underscore (the name is shown as the agent)"),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1, "Pick at least one permission"),
});

/** Creates a token. The raw value is returned once and only its hash is stored. */
export async function createApiToken(
  db: Db,
  projectId: string,
  raw: { name: string; scopes: string[] },
  actor: Actor,
): Promise<{ token: string; record: ApiToken }> {
  if (actor.kind !== "owner") throw new ValidationError("Only the owner can create tokens");
  const input = createInput.parse(raw);
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const [record] = await db
    .insert(apiTokens)
    .values({ projectId, name: input.name, scopes: input.scopes, tokenHash: hashToken(token) })
    .returning();
  return { token, record };
}

export async function listApiTokens(db: Db, projectId: string): Promise<ApiToken[]> {
  return db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.projectId, projectId))
    .orderBy(desc(apiTokens.createdAt));
}

export async function revokeApiToken(db: Db, tokenId: string, actor: Actor): Promise<void> {
  if (actor.kind !== "owner") throw new ValidationError("Only the owner can revoke tokens");
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (!row) throw new NotFoundError("Active token");
}

/** Resolves a raw bearer token to its project. Returns null for unknown or revoked tokens. */
export async function authenticateToken(
  db: Db,
  raw: string | null | undefined,
): Promise<{ token: ApiToken; project: Project } | null> {
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db
    .select({ token: apiTokens, project: projects })
    .from(apiTokens)
    .innerJoin(projects, eq(projects.id, apiTokens.projectId))
    .where(and(eq(apiTokens.tokenHash, hashToken(raw)), isNull(apiTokens.revokedAt)));
  if (!row) return null;
  // Best effort; a failed timestamp update must not block the request.
  await db
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiTokens.id, row.token.id))
    .catch(() => undefined);
  return row;
}

/** Extracts the token from an `Authorization: Bearer ...` header. */
export function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}
