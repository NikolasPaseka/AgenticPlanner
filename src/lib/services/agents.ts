// Operations available to AI agents through the MCP server and REST API.
// Every call is scoped to the token's project and checked against its scopes.
// Agents can never merge, accept proposals, change settings, or flip the agents switch:
// those transitions are owner-only in the state machine and have no agent operation here.

import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { agentRuns, comments, reviews, taskEvents, tasks } from "@/lib/db/schema";
import { isClaimable, type TaskStatus } from "@/lib/domain/tasks";
import { PRIORITIES, TASK_TYPES } from "@/lib/validation";
import type { Actor } from "./actor";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import type { Project } from "./projects";
import { getAppSettings } from "./settings";
import { addComment, createTask, getTaskByNumber, listTasks, transitionTask, type Task } from "./tasks";
import type { ApiToken, TokenScope } from "./tokens";

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type AgentContext = { project: Project; token: ApiToken; actor: Actor };

export function agentContext(project: Project, token: ApiToken): AgentContext {
  return { project, token, actor: { kind: "agent", name: token.name } };
}

function requireScope(ctx: AgentContext, scope: TokenScope) {
  if (!ctx.token.scopes.includes(scope)) {
    throw new ForbiddenError(`Token "${ctx.token.name}" lacks the ${scope} permission`);
  }
}

/** Accepts "AP-12", "ap-12", or "12" for the token's project. */
export function parseTaskKey(project: Project, key: string): number {
  const m = key.trim().toUpperCase().match(new RegExp(`^(?:${project.key}-)?(\\d+)$`));
  if (!m) throw new ValidationError(`"${key}" is not a task key of project ${project.key}`);
  return Number(m[1]);
}

async function taskByKey(db: Db, ctx: AgentContext, key: string): Promise<Task> {
  return getTaskByNumber(db, ctx.project.id, parseTaskKey(ctx.project, key));
}

async function logEvent(
  db: Db,
  taskId: string,
  ctx: AgentContext,
  type: string,
  payload: Record<string, unknown> = {},
) {
  await db.insert(taskEvents).values({ taskId, actorType: "agent", actor: ctx.actor.name, type, payload });
}

/** A compact task shape for agents. */
export function presentTask(project: Project, t: Task) {
  return {
    key: `${project.key}-${t.number}`,
    title: t.title,
    status: t.status,
    priority: t.priority,
    type: t.type,
    labels: t.labels,
    onHold: t.onHold,
    description: t.description,
    acceptanceCriteria: t.acceptanceCriteria,
    branch: t.branchName,
    pullRequest: t.prNumber ? { number: t.prNumber, url: t.prUrl } : null,
    source: t.source,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function agentListTasks(
  db: Db,
  ctx: AgentContext,
  filters: { status?: TaskStatus; priority?: string; limit?: number },
) {
  requireScope(ctx, "tasks:read");
  const rows = await listTasks(db, ctx.project, {
    priority: filters.priority,
    includeClosed: filters.status ? ["merged", "done", "cancelled"].includes(filters.status) : false,
  });
  return rows
    .filter((t) => !filters.status || t.status === filters.status)
    .slice(0, filters.limit ?? 50)
    .map((t) => presentTask(ctx.project, t));
}

export async function agentGetTask(db: Db, ctx: AgentContext, key: string) {
  requireScope(ctx, "tasks:read");
  const task = await taskByKey(db, ctx, key);
  const [notes, [latestReview]] = await Promise.all([
    db.select().from(comments).where(eq(comments.taskId, task.id)).orderBy(comments.createdAt),
    db.select().from(reviews).where(eq(reviews.taskId, task.id)).orderBy(desc(reviews.createdAt)).limit(1),
  ]);
  return {
    ...presentTask(ctx.project, task),
    comments: notes.map((c) => ({
      author: c.author,
      authorType: c.authorType,
      body: c.body,
      at: c.createdAt.toISOString(),
    })),
    latestReview: latestReview
      ? { reviewer: latestReview.reviewer, verdict: latestReview.verdict, body: latestReview.body, findings: latestReview.findings }
      : null,
  };
}

/**
 * Claims a Todo or Changes-requested task and starts an agent run.
 * Refused when agents are switched off globally or the task is on hold.
 */
export async function agentClaimTask(
  db: Db,
  ctx: AgentContext,
  key: string,
  opts: { runId?: string; githubRunId?: number; role?: "developer" } = {},
) {
  requireScope(ctx, "tasks:write");
  const settings = await getAppSettings(db);
  if (!settings.agentsEnabled) throw new ConflictError("Agents are paused by the owner; try again later");
  const task = await taskByKey(db, ctx, key);

  const runFields = {
    status: "running" as const,
    startedAt: sql`now()`,
    agent: ctx.actor.name,
    apiTokenId: ctx.token.id,
    ...(opts.githubRunId ? { githubRunId: opts.githubRunId } : {}),
  };

  if (opts.runId) {
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, opts.runId), eq(agentRuns.projectId, ctx.project.id)));
    if (!run) throw new NotFoundError(`Run ${opts.runId}`);
    if (run.status !== "queued" && run.status !== "running") {
      throw new ConflictError(`Run ${opts.runId} is ${run.status}${run.cancelledBy ? ` (stopped by ${run.cancelledBy})` : ""}; stop working on it`);
    }
    // The dispatcher already moved the task to in_progress for this run.
    if (run.taskId === task.id && task.status === "in_progress") {
      await db.update(agentRuns).set(runFields).where(eq(agentRuns.id, run.id));
      await db.update(tasks).set({ assignee: ctx.actor.name }).where(eq(tasks.id, task.id));
      return { task: presentTask(ctx.project, task), runId: run.id };
    }
  }

  if (task.onHold) throw new ConflictError(`${key} is on hold`);
  if (!isClaimable(task)) throw new ConflictError(`${key} is ${task.status}; only todo or changes_requested tasks can be claimed`);

  const claimed = await transitionTask(db, task.id, "in_progress", ctx.actor, { via: "claim" });
  await db.update(tasks).set({ assignee: ctx.actor.name }).where(eq(tasks.id, task.id));

  let runId = opts.runId;
  if (runId) {
    await db.update(agentRuns).set({ ...runFields, taskId: task.id }).where(eq(agentRuns.id, runId));
  } else {
    const [run] = await db
      .insert(agentRuns)
      .values({ projectId: ctx.project.id, taskId: task.id, role: opts.role ?? "developer", ...runFields })
      .returning({ id: agentRuns.id });
    runId = run.id;
  }
  return { task: presentTask(ctx.project, claimed), runId };
}

export async function agentUpdateProgress(db: Db, ctx: AgentContext, key: string, message: string) {
  requireScope(ctx, "tasks:write");
  const task = await taskByKey(db, ctx, key);
  await addComment(db, task.id, { body: message }, ctx.actor);
  return { ok: true };
}

export async function agentLinkBranch(db: Db, ctx: AgentContext, key: string, branch: string) {
  requireScope(ctx, "tasks:write");
  const name = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[\w./-]+$/, "Invalid branch name")
    .parse(branch);
  const task = await taskByKey(db, ctx, key);
  await db.update(tasks).set({ branchName: name, updatedAt: sql`now()` }).where(eq(tasks.id, task.id));
  await logEvent(db, task.id, ctx, "branch_linked", { branch: name });
  return { ok: true };
}

const prInput = z.object({
  summary: z.string().trim().min(1).max(20000),
  prNumber: z.number().int().positive().optional(),
  prUrl: z.url().optional(),
  branch: z.string().trim().max(200).optional(),
});

/** Moves an in-progress task to review, with a summary and optional PR link. */
export async function agentSubmitForReview(db: Db, ctx: AgentContext, key: string, raw: z.input<typeof prInput>) {
  requireScope(ctx, "tasks:write");
  const input = prInput.parse(raw);
  const task = await taskByKey(db, ctx, key);
  const moved = await transitionTask(db, task.id, "in_review", ctx.actor, {
    prNumber: input.prNumber ?? null,
  });
  await db
    .update(tasks)
    .set({
      prNumber: input.prNumber ?? task.prNumber,
      prUrl: input.prUrl ?? task.prUrl,
      branchName: input.branch ?? task.branchName,
    })
    .where(eq(tasks.id, task.id));
  await addComment(db, task.id, { body: input.summary }, ctx.actor);
  return { task: presentTask(ctx.project, { ...moved, prNumber: input.prNumber ?? task.prNumber }) };
}

/** Marks a task blocked and records the question for the owner. */
export async function agentReportBlocked(db: Db, ctx: AgentContext, key: string, question: string) {
  requireScope(ctx, "tasks:write");
  const task = await taskByKey(db, ctx, key);
  await transitionTask(db, task.id, "blocked", ctx.actor, { question });
  await addComment(db, task.id, { body: `Blocked: ${question}` }, ctx.actor);
  return { ok: true };
}

/** Agent change requests allowed per task before the owner has to step in. */
export const REVIEW_ROUNDS_LIMIT = 3;

async function countAgentChangeRequests(db: Db, taskId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(reviews)
    .where(and(eq(reviews.taskId, taskId), eq(reviews.verdict, "request_changes")));
  return n;
}

const reviewInput = z.object({
  verdict: z.enum(["approve", "request_changes", "comment"]),
  body: z.string().trim().max(20000).default(""),
  findings: z
    .array(
      z.object({
        severity: z.enum(["critical", "major", "minor", "nit"]),
        file: z.string().max(500).optional(),
        line: z.number().int().positive().optional(),
        message: z.string().min(1).max(5000),
      }),
    )
    .max(100)
    .default([]),
});

/**
 * Stores a review. `request_changes` on a task in review moves it to changes_requested.
 * `approve` is a recommendation only: merging stays with the owner.
 */
export async function agentRecordReview(db: Db, ctx: AgentContext, key: string, raw: z.input<typeof reviewInput>) {
  requireScope(ctx, "reviews:write");
  const input = reviewInput.parse(raw);
  const task = await taskByKey(db, ctx, key);
  const [review] = await db
    .insert(reviews)
    .values({ taskId: task.id, prNumber: task.prNumber, reviewer: ctx.actor.name, ...input })
    .returning({ id: reviews.id });
  await logEvent(db, task.id, ctx, "review_recorded", { verdict: input.verdict, findings: input.findings.length });
  if (input.verdict === "request_changes" && task.status === "in_review") {
    const agentRounds = await countAgentChangeRequests(db, task.id);
    if (agentRounds > REVIEW_ROUNDS_LIMIT) {
      // Developer and reviewer agents keep disagreeing: stop the loop and let the owner decide.
      await db.update(tasks).set({ onHold: true }).where(eq(tasks.id, task.id));
      await logEvent(db, task.id, ctx, "review_loop_stopped", { rounds: agentRounds - 1 });
      return { reviewId: review.id, note: "Review round limit reached; the owner will decide." };
    }
    await transitionTask(db, task.id, "changes_requested", ctx.actor, { reviewId: review.id });
  }
  return { reviewId: review.id };
}

const proposeInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20000).default(""),
  acceptanceCriteria: z.string().trim().max(20000).default(""),
  type: z.enum(TASK_TYPES).default("bug"),
  priority: z.enum(PRIORITIES).default("medium"),
  labels: z.array(z.string()).max(10).default([]),
  parentKey: z.string().optional(),
  runId: z.uuid().optional(),
});

/**
 * Proposes a new task. It lands in "Proposed by agents" until the owner accepts it.
 * Limited to the project's maxProposalsPerRun per run, or per token per hour without a run.
 */
export async function agentProposeTask(db: Db, ctx: AgentContext, raw: z.input<typeof proposeInput>) {
  requireScope(ctx, "tasks:propose");
  const input = proposeInput.parse(raw);
  const limit = ctx.project.settings.maxProposalsPerRun;
  const [{ n }] = await db
    .select({ n: count() })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, ctx.project.id),
        eq(tasks.source, "agent"),
        input.runId
          ? eq(tasks.createdByRunId, input.runId)
          : and(eq(tasks.createdByAgent, ctx.actor.name), gt(tasks.createdAt, sql`now() - interval '1 hour'`)),
      ),
    );
  if (n >= limit) {
    throw new ConflictError(`Proposal limit reached (${limit} per run). Ask the owner to raise it in project settings.`);
  }
  const parent = input.parentKey ? await taskByKey(db, ctx, input.parentKey) : null;
  const task = await createTask(
    db,
    ctx.project.id,
    { ...input, parentTaskId: parent?.id ?? null },
    ctx.actor,
  );
  if (input.runId) {
    await db.update(tasks).set({ createdByRunId: input.runId }).where(eq(tasks.id, task.id));
  }
  return presentTask(ctx.project, task);
}

const finishInput = z.object({
  status: z.enum(["succeeded", "failed", "cancelled"]),
  summary: z.string().trim().max(20000).optional(),
  costUsd: z.number().nonnegative().max(10000).optional(),
});

export async function agentFinishRun(db: Db, ctx: AgentContext, runId: string, raw: z.input<typeof finishInput>) {
  requireScope(ctx, "tasks:write");
  const input = finishInput.parse(raw);
  const [run] = await db
    .update(agentRuns)
    .set({
      status: input.status,
      summary: input.summary ?? null,
      costUsd: input.costUsd?.toFixed(4) ?? null,
      finishedAt: sql`now()`,
    })
    .where(
      and(
        eq(agentRuns.id, runId),
        eq(agentRuns.projectId, ctx.project.id),
        sql`${agentRuns.status} in ('queued', 'running')`,
      ),
    )
    .returning({ id: agentRuns.id });
  if (!run) throw new NotFoundError(`Active run ${runId}`);
  return { ok: true };
}

export async function listRunsForTask(db: Db, taskId: string) {
  return db.select().from(agentRuns).where(eq(agentRuns.taskId, taskId)).orderBy(desc(agentRuns.createdAt));
}
