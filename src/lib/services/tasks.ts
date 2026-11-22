import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { comments, projects, reviews, taskEvents, tasks } from "@/lib/db/schema";
import { assertTransition, type TaskStatus } from "@/lib/domain/tasks";
import {
  commentInput,
  taskInput,
  taskUpdateInput,
  type TaskInput,
  type TaskUpdateInput,
} from "@/lib/validation";
import { actorColumn, type Actor } from "./actor";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export type Task = typeof tasks.$inferSelect;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Review = typeof reviews.$inferSelect;

export const CLOSED_STATUSES: TaskStatus[] = ["merged", "done", "cancelled"];

/** Creates a task with the next per-project number. Agents always create `proposed` tasks. */
export async function createTask(
  db: Db,
  projectId: string,
  raw: TaskInput & { status?: "todo" | "backlog" | "proposed"; parentTaskId?: string | null },
  actor: Actor,
): Promise<Task> {
  const input = taskInput.parse(raw);
  const status = actor.kind === "agent" ? "proposed" : (raw.status ?? "todo");
  return db.transaction(async (tx) => {
    const [counter] = await tx
      .update(projects)
      .set({ nextTaskNumber: sql`${projects.nextTaskNumber} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ number: sql<number>`${projects.nextTaskNumber} - 1` });
    if (!counter) throw new NotFoundError("Project");
    const [task] = await tx
      .insert(tasks)
      .values({
        ...input,
        projectId,
        number: Number(counter.number),
        status,
        source: actorColumn(actor),
        createdByAgent: actor.kind === "agent" ? actor.name : null,
        parentTaskId: raw.parentTaskId ?? null,
      })
      .returning();
    await tx.insert(taskEvents).values({
      taskId: task.id,
      actorType: actorColumn(actor),
      actor: actor.name,
      type: "created",
      to: status,
    });
    return task;
  });
}

export type TaskFilters = {
  q?: string;
  priority?: string;
  type?: string;
  includeClosed?: boolean;
  /** Only these statuses; overrides includeClosed. */
  statuses?: readonly TaskStatus[];
  /** "priority" (default): most urgent first. "recent": last updated first. */
  order?: "priority" | "recent";
};

export async function listTasks(
  db: Db,
  project: { id: string; key: string },
  filters: TaskFilters = {},
): Promise<Task[]> {
  const where: SQL[] = [eq(tasks.projectId, project.id)];
  if (filters.statuses) {
    where.push(inArray(tasks.status, [...filters.statuses]));
  } else if (!filters.includeClosed) {
    where.push(sql`${tasks.status} not in ('merged', 'done', 'cancelled')`);
  }
  if (filters.priority) where.push(eq(tasks.priority, filters.priority as Task["priority"]));
  if (filters.type) where.push(eq(tasks.type, filters.type as Task["type"]));
  const q = filters.q?.trim();
  if (q) {
    const keyMatch = q.toUpperCase().match(new RegExp(`^(?:${project.key}-)?(\\d+)$`));
    if (keyMatch) where.push(eq(tasks.number, Number(keyMatch[1])));
    else where.push(ilike(tasks.title, `%${q.replace(/[%_\\]/g, "\\$&")}%`));
  }
  return db
    .select()
    .from(tasks)
    .where(and(...where))
    .orderBy(
      ...(filters.order === "recent"
        ? [desc(tasks.updatedAt), desc(tasks.number)]
        : [
            sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
            asc(tasks.position),
            asc(tasks.number),
          ]),
    );
}

export async function getTaskByNumber(db: Db, projectId: string, number: number): Promise<Task> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.number, number)));
  if (!task) throw new NotFoundError(`Task ${number}`);
  return task;
}

async function getTaskById(db: Db, taskId: string): Promise<Task> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new NotFoundError("Task");
  return task;
}

const EDITABLE_FIELDS = [
  "title",
  "description",
  "acceptanceCriteria",
  "priority",
  "type",
  "labels",
] as const;

export async function updateTask(
  db: Db,
  taskId: string,
  raw: TaskUpdateInput,
  actor: Actor,
): Promise<Task> {
  const input = taskUpdateInput.parse(raw);
  return db.transaction(async (tx) => {
    const current = await getTaskById(tx, taskId);
    const changed = EDITABLE_FIELDS.filter(
      (f) =>
        input[f] !== undefined && JSON.stringify(input[f]) !== JSON.stringify(current[f]),
    );
    if (changed.length === 0) return current;
    const patch = Object.fromEntries(changed.map((f) => [f, input[f]]));
    const [task] = await tx
      .update(tasks)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(tasks.id, taskId))
      .returning();
    await tx.insert(taskEvents).values({
      taskId,
      actorType: actorColumn(actor),
      actor: actor.name,
      type: "updated",
      payload: { fields: changed },
    });
    return task;
  });
}

/**
 * Moves a task to a new status if the state machine allows it for this actor.
 * The update only applies if nobody changed the status in the meantime.
 */
export async function transitionTask(
  db: Db,
  taskId: string,
  to: TaskStatus,
  actor: Actor,
  payload: Record<string, unknown> = {},
): Promise<Task> {
  return db.transaction(async (tx) => {
    const current = await getTaskById(tx, taskId);
    assertTransition(current.status, to, actor.kind);
    if (actor.kind === "agent" && current.onHold && to === "in_progress") {
      throw new ConflictError("Task is on hold");
    }
    const [task] = await tx
      .update(tasks)
      .set({ status: to, updatedAt: sql`now()` })
      .where(and(eq(tasks.id, taskId), eq(tasks.status, current.status)))
      .returning();
    if (!task) throw new ConflictError("Task status changed, reload and try again");
    await tx.insert(taskEvents).values({
      taskId,
      actorType: actorColumn(actor),
      actor: actor.name,
      type: "status_changed",
      from: current.status,
      to,
      payload,
    });
    return task;
  });
}

/** Puts a task on hold or releases it. Only the owner can do this. */
export async function setTaskHold(
  db: Db,
  taskId: string,
  onHold: boolean,
  actor: Actor,
): Promise<Task> {
  if (actor.kind !== "owner") throw new ValidationError("Only the owner can hold tasks");
  return db.transaction(async (tx) => {
    const [task] = await tx
      .update(tasks)
      .set({ onHold, updatedAt: sql`now()` })
      .where(and(eq(tasks.id, taskId), eq(tasks.onHold, !onHold)))
      .returning();
    if (!task) return getTaskById(tx, taskId);
    await tx.insert(taskEvents).values({
      taskId,
      actorType: actorColumn(actor),
      actor: actor.name,
      type: onHold ? "hold_set" : "hold_released",
    });
    return task;
  });
}

export async function addComment(
  db: Db,
  taskId: string,
  raw: { body: string },
  actor: Actor,
): Promise<Comment> {
  const { body } = commentInput.parse(raw);
  await getTaskById(db, taskId);
  const [comment] = await db
    .insert(comments)
    .values({ taskId, authorType: actorColumn(actor), author: actor.name, body })
    .returning();
  return comment;
}

export type TimelineItem =
  | { kind: "event"; at: Date; event: TaskEvent }
  | { kind: "comment"; at: Date; comment: Comment };

/** Events and comments of a task, oldest first. */
export async function getTimeline(db: Db, taskId: string): Promise<TimelineItem[]> {
  const [events, notes] = await Promise.all([
    db.select().from(taskEvents).where(eq(taskEvents.taskId, taskId)).orderBy(asc(taskEvents.createdAt)),
    db.select().from(comments).where(eq(comments.taskId, taskId)).orderBy(asc(comments.createdAt)),
  ]);
  const items: TimelineItem[] = [
    ...events.map((e) => ({ kind: "event" as const, at: e.createdAt, event: e })),
    ...notes.map((c) => ({ kind: "comment" as const, at: c.createdAt, comment: c })),
  ];
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function getTasksByIds(db: Db, ids: string[]): Promise<Task[]> {
  if (ids.length === 0) return [];
  return db.select().from(tasks).where(inArray(tasks.id, ids)).orderBy(desc(tasks.createdAt));
}

/** Reviews of these tasks, newest first. */
export async function listReviewsForTasks(db: Db, taskIds: string[]): Promise<Review[]> {
  if (taskIds.length === 0) return [];
  return db.select().from(reviews).where(inArray(reviews.taskId, taskIds)).orderBy(desc(reviews.createdAt));
}

/** Comments agents left on these tasks (their work summaries), newest first. */
export async function listAgentComments(db: Db, taskIds: string[]): Promise<Comment[]> {
  if (taskIds.length === 0) return [];
  return db
    .select()
    .from(comments)
    .where(and(inArray(comments.taskId, taskIds), eq(comments.authorType, "agent")))
    .orderBy(desc(comments.createdAt));
}
