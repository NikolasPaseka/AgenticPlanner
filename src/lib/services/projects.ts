import { asc, count, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { projects, tasks } from "@/lib/db/schema";
import type { TaskStatus } from "@/lib/domain/tasks";
import {
  projectInput,
  projectSettingsInput,
  type ProjectInput,
  type ProjectSettingsInput,
} from "@/lib/validation";
import { ConflictError, NotFoundError } from "./errors";

export type Project = typeof projects.$inferSelect;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

function isUniqueViolation(e: unknown): boolean {
  // Postgres unique_violation, possibly wrapped by Drizzle in `cause`.
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export async function createProject(db: Db, raw: ProjectInput): Promise<Project> {
  const input = projectInput.parse(raw);
  const base = slugify(input.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const [project] = await db
        .insert(projects)
        .values({ ...input, slug })
        .returning();
      return project;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const [existingKey] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.key, input.key));
      if (existingKey) throw new ConflictError(`Project key ${input.key} is already used`);
    }
  }
  throw new ConflictError("Could not find a free project slug");
}

export async function listProjectsWithCounts(db: Db) {
  const rows = await db.select().from(projects).orderBy(asc(projects.name));
  const counts = await db
    .select({ projectId: tasks.projectId, status: tasks.status, n: count() })
    .from(tasks)
    .groupBy(tasks.projectId, tasks.status);
  return rows.map((p) => {
    const byStatus: Partial<Record<TaskStatus, number>> = {};
    for (const c of counts) if (c.projectId === p.id) byStatus[c.status] = c.n;
    return { ...p, counts: byStatus };
  });
}

export async function getProjectBySlug(db: Db, slug: string): Promise<Project> {
  const [project] = await db.select().from(projects).where(eq(projects.slug, slug));
  if (!project) throw new NotFoundError(`Project ${slug}`);
  return project;
}

export async function updateProjectSettings(
  db: Db,
  projectId: string,
  raw: ProjectSettingsInput,
): Promise<Project> {
  const input = projectSettingsInput.parse(raw);
  const { autoDispatch, maxParallelRuns, maxProposalsPerRun, mergeMethod, ...fields } = input;
  const [project] = await db
    .update(projects)
    .set({
      ...fields,
      settings: { autoDispatch, maxParallelRuns, maxProposalsPerRun, mergeMethod },
      updatedAt: sql`now()`,
    })
    .where(eq(projects.id, projectId))
    .returning();
  if (!project) throw new NotFoundError("Project");
  return project;
}
