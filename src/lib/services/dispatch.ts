// Auto-dispatch: starts GitHub Actions agent runs for the next task, and keeps runs
// and tasks consistent when runs are stopped, fail, or finish.

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { agentRuns, projects, taskEvents, tasks } from "@/lib/db/schema";
import { formatTaskKey, isClaimable, pickNextTask, projectDispatchBlocker } from "@/lib/domain/tasks";
import type { GitHubGateway } from "@/lib/github/gateway";
import type { Actor } from "./actor";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import type { Project } from "./projects";
import { getAppSettings } from "./settings";
import { transitionTask, type Task } from "./tasks";

export const DEVELOP_WORKFLOW = "agentplanner-develop.yml";
const SYSTEM: Actor = { kind: "system", name: "dispatcher" };
const ACTIVE = ["queued", "running"] as const;

export type AgentRun = typeof agentRuns.$inferSelect;

async function logEvent(db: Db, taskId: string, actor: Actor, type: string, payload: Record<string, unknown> = {}) {
  await db.insert(taskEvents).values({
    taskId,
    actorType: actor.kind === "owner" ? "user" : actor.kind,
    actor: actor.name,
    type,
    payload,
  });
}

function connected(project: Project) {
  return !!(project.githubOwner && project.githubRepo && project.githubInstallationId);
}

/**
 * Reserves the task for a new run inside a per-project lock, so concurrent
 * dispatchers cannot exceed the parallel limit or start the same task twice.
 */
async function reserve(
  db: Db,
  project: Project,
  choose: (candidates: Task[], activeRuns: number) => Task | null,
  actor: Actor,
): Promise<{ task: Task; run: AgentRun } | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${project.id}))`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, project.id), inArray(agentRuns.status, [...ACTIVE])));
    const candidates = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, project.id), inArray(tasks.status, ["todo", "changes_requested"])));
    const task = choose(candidates, n);
    if (!task) return null;
    const [run] = await tx
      .insert(agentRuns)
      .values({ projectId: project.id, taskId: task.id, role: "developer", agent: "github-actions", status: "queued" })
      .returning();
    const moved = await transitionTask(tx, task.id, "in_progress", actor, { runId: run.id, via: "dispatch" });
    return { task: moved, run };
  });
}

async function startWorkflow(db: Db, gh: GitHubGateway, project: Project, task: Task, run: AgentRun) {
  try {
    await gh.dispatchWorkflow(
      project.githubInstallationId!,
      project.githubOwner!,
      project.githubRepo!,
      DEVELOP_WORKFLOW,
      project.defaultBranch,
      { task_key: formatTaskKey(project.key, task.number), run_id: run.id },
    );
    await logEvent(db, task.id, SYSTEM, "run_dispatched", { runId: run.id });
  } catch (e) {
    // Roll back and hold the task so the dispatcher does not retry in a loop.
    const message = (e as Error).message ?? "unknown error";
    await db.update(agentRuns).set({ status: "failed", summary: `Dispatch failed: ${message}`, finishedAt: sql`now()` }).where(eq(agentRuns.id, run.id));
    await transitionTask(db, task.id, "todo", SYSTEM, { runId: run.id, via: "dispatch_failed" });
    await db.update(tasks).set({ onHold: true }).where(eq(tasks.id, task.id));
    await logEvent(db, task.id, SYSTEM, "dispatch_failed", { message });
  }
}

/** Starts the next task for one project if every switch allows it. Returns the run, or null. */
export async function dispatchNext(db: Db, gh: GitHubGateway, project: Project): Promise<AgentRun | null> {
  if (!connected(project)) return null;
  const settings = await getAppSettings(db);
  const reserved = await reserve(
    db,
    project,
    (candidates, activeRuns) =>
      pickNextTask(
        {
          agentsEnabled: settings.agentsEnabled,
          project: { ...project.settings, activeRuns },
        },
        candidates,
      ),
    SYSTEM,
  );
  if (!reserved) return null;
  await startWorkflow(db, gh, project, reserved.task, reserved.run);
  return reserved.run;
}

/** Fills free agent slots in every connected project. Safe to call often. */
export async function dispatchAll(db: Db, gh: GitHubGateway): Promise<number> {
  const settings = await getAppSettings(db);
  if (!settings.agentsEnabled) return 0;
  const all = await db.select().from(projects).where(isNotNull(projects.githubInstallationId));
  let started = 0;
  for (const project of all) {
    if (projectDispatchBlocker({ agentsEnabled: true, project: { ...project.settings, activeRuns: 0 } })) continue;
    for (let i = 0; i < project.settings.maxParallelRuns; i++) {
      if (!(await dispatchNext(db, gh, project))) break;
      started++;
    }
  }
  return started;
}

/**
 * The owner starts an agent on one task now. Works with auto-dispatch off and
 * releases a hold, but respects the global agents switch.
 */
export async function dispatchTask(db: Db, gh: GitHubGateway, taskId: string, actor: Actor): Promise<AgentRun> {
  if (actor.kind !== "owner") throw new ValidationError("Only the owner can start agents");
  const [row] = await db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId));
  if (!row) throw new NotFoundError("Task");
  const { project } = row;
  if (!connected(project)) throw new ValidationError("Connect the GitHub repository in project settings first");
  if (!(await getAppSettings(db)).agentsEnabled) throw new ConflictError("Agents are paused. Switch them on first.");
  if (row.task.onHold) {
    await db.update(tasks).set({ onHold: false }).where(eq(tasks.id, taskId));
    await logEvent(db, taskId, actor, "hold_released", { via: "dispatch" });
  }
  const reserved = await reserve(
    db,
    project,
    (candidates) => candidates.find((t) => t.id === taskId && isClaimable({ ...t, onHold: false })) ?? null,
    actor,
  );
  if (!reserved) throw new ConflictError("Only Todo or Changes-requested tasks can be started");
  await startWorkflow(db, gh, project, reserved.task, reserved.run);
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, reserved.run.id));
  if (run.status === "failed") throw new ConflictError(run.summary ?? "Dispatch failed");
  return run;
}

/**
 * The owner stops a run: cancels the GitHub Actions run, keeps the branch, sends the
 * task to Todo or Blocked, and puts it on hold so it is not picked up again right away.
 */
export async function stopRun(
  db: Db,
  gh: GitHubGateway | null,
  runId: string,
  mode: "todo" | "blocked",
  actor: Actor,
): Promise<{ warning?: string }> {
  if (actor.kind !== "owner") throw new ValidationError("Only the owner can stop runs");
  const [row] = await db
    .select({ run: agentRuns, project: projects })
    .from(agentRuns)
    .innerJoin(projects, eq(projects.id, agentRuns.projectId))
    .where(eq(agentRuns.id, runId));
  if (!row) throw new NotFoundError("Run");
  const { run, project } = row;
  if (!ACTIVE.includes(run.status as (typeof ACTIVE)[number])) throw new ConflictError(`Run is already ${run.status}`);

  await db
    .update(agentRuns)
    .set({ status: "cancelled", cancelledBy: actor.name, finishedAt: sql`now()` })
    .where(eq(agentRuns.id, runId));

  let warning: string | undefined;
  if (run.githubRunId && gh && connected(project)) {
    try {
      await gh.cancelWorkflowRun(project.githubInstallationId!, project.githubOwner!, project.githubRepo!, run.githubRunId);
    } catch {
      warning = "The run is marked stopped, but cancelling it on GitHub failed. Check the Actions tab.";
    }
  } else if (!run.githubRunId && run.agent === "github-actions") {
    warning = "The GitHub run had not reported its id yet. The agent will be refused when it tries to claim the task.";
  }

  if (run.taskId) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, run.taskId));
    if (task?.status === "in_progress") await transitionTask(db, task.id, mode, actor, { runId, via: "stop" });
    await db.update(tasks).set({ onHold: true }).where(eq(tasks.id, run.taskId));
    await logEvent(db, run.taskId, actor, "run_stopped", { runId });
  }
  return { warning };
}

type WorkflowRunPayload = {
  action: string;
  repository: { name: string; owner: { login: string } };
  workflow_run: { id: number; display_title?: string; name?: string; html_url: string; status: string; conclusion: string | null };
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Links GitHub Actions runs to agent runs (the develop workflow puts the run id in
 * its run name) and cleans up when a run ends without the agent closing it.
 */
export async function handleWorkflowRun(db: Db, p: WorkflowRunPayload): Promise<string> {
  const runId = (p.workflow_run.display_title ?? "").match(UUID)?.[0];
  if (!runId) return "not an AgentPlanner run";
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) return "unknown run";
  if (!run.githubRunId) {
    await db
      .update(agentRuns)
      .set({ githubRunId: p.workflow_run.id, githubRunUrl: p.workflow_run.html_url })
      .where(eq(agentRuns.id, runId));
  }
  if (p.action !== "completed") return `run ${runId} linked`;

  const conclusion = p.workflow_run.conclusion ?? "failure";
  if (ACTIVE.includes(run.status as (typeof ACTIVE)[number])) {
    await db
      .update(agentRuns)
      .set({
        status: conclusion === "success" ? "succeeded" : conclusion === "cancelled" ? "cancelled" : "failed",
        finishedAt: sql`now()`,
      })
      .where(eq(agentRuns.id, runId));
  }
  if (run.taskId) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, run.taskId));
    // The run ended but the task never reached review: hold it for the owner instead of retrying forever.
    if (task?.status === "in_progress" && run.status !== "cancelled") {
      await transitionTask(db, task.id, "todo", SYSTEM, { runId, conclusion });
      await db.update(tasks).set({ onHold: true }).where(eq(tasks.id, task.id));
      await logEvent(db, task.id, SYSTEM, "run_ended_without_review", { runId, conclusion });
    }
  }
  return `run ${runId} ${conclusion}`;
}

export async function listRuns(db: Db, projectId: string, limit = 50) {
  return db
    .select({ run: agentRuns, task: { number: tasks.number, title: tasks.title } })
    .from(agentRuns)
    .leftJoin(tasks, eq(tasks.id, agentRuns.taskId))
    .where(eq(agentRuns.projectId, projectId))
    .orderBy(sql`${agentRuns.createdAt} desc`)
    .limit(limit);
}
