// Task state machine. The single source of truth for allowed status changes.
// Keep in sync with docs/data-model.md.

export const TASK_STATUSES = [
  "proposed",
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "changes_requested",
  "merged",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Actor = "owner" | "agent" | "system";

type Rule = { to: TaskStatus; by: readonly Actor[] };

const TRANSITIONS: Record<TaskStatus, readonly Rule[]> = {
  proposed: [
    { to: "todo", by: ["owner"] },
    { to: "backlog", by: ["owner"] },
    { to: "cancelled", by: ["owner"] },
  ],
  backlog: [
    { to: "todo", by: ["owner"] },
    { to: "cancelled", by: ["owner"] },
  ],
  todo: [
    { to: "in_progress", by: ["owner", "agent", "system"] },
    { to: "backlog", by: ["owner"] },
    { to: "cancelled", by: ["owner"] },
  ],
  in_progress: [
    { to: "in_review", by: ["owner", "agent"] },
    { to: "blocked", by: ["owner", "agent"] },
    { to: "todo", by: ["owner", "system"] },
    { to: "cancelled", by: ["owner"] },
  ],
  blocked: [
    { to: "in_progress", by: ["owner", "agent"] },
    { to: "todo", by: ["owner"] },
    { to: "cancelled", by: ["owner"] },
  ],
  in_review: [
    { to: "changes_requested", by: ["owner", "agent"] },
    { to: "merged", by: ["owner"] },
    { to: "todo", by: ["owner"] },
    { to: "cancelled", by: ["owner"] },
  ],
  changes_requested: [
    { to: "in_progress", by: ["owner", "agent", "system"] },
    { to: "cancelled", by: ["owner"] },
  ],
  merged: [{ to: "done", by: ["system", "owner"] }],
  done: [{ to: "todo", by: ["owner"] }],
  cancelled: [{ to: "todo", by: ["owner"] }],
};

export function canTransition(from: TaskStatus, to: TaskStatus, actor: Actor): boolean {
  return TRANSITIONS[from].some((r) => r.to === to && r.by.includes(actor));
}

export function allowedTransitions(from: TaskStatus, actor: Actor): TaskStatus[] {
  return TRANSITIONS[from].filter((r) => r.by.includes(actor)).map((r) => r.to);
}

export class InvalidTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus, actor: Actor) {
    super(`Transition ${from} -> ${to} is not allowed for ${actor}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: TaskStatus, to: TaskStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) throw new InvalidTransitionError(from, to, actor);
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;
export type TaskPriority = keyof typeof PRIORITY_RANK;

/** Order used by the auto-dispatcher: highest priority first, then oldest. */
export function compareForDispatch(
  a: { priority: TaskPriority; createdAt: Date },
  b: { priority: TaskPriority; createdAt: Date },
): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.createdAt.getTime() - b.createdAt.getTime()
  );
}

export type DispatchContext = {
  agentsEnabled: boolean;
  project: { autoDispatch: boolean; maxParallelRuns: number; activeRuns: number };
};

export type DispatchCandidate = {
  status: TaskStatus;
  onHold: boolean;
  priority: TaskPriority;
  createdAt: Date;
};

/** Why automatic dispatch is blocked for the whole project, or null if it may run. */
export function projectDispatchBlocker(
  ctx: DispatchContext,
): "agents_disabled" | "auto_dispatch_off" | "parallel_limit" | null {
  if (!ctx.agentsEnabled) return "agents_disabled";
  if (!ctx.project.autoDispatch) return "auto_dispatch_off";
  if (ctx.project.activeRuns >= ctx.project.maxParallelRuns) return "parallel_limit";
  return null;
}

/** Whether an agent may claim this task (automatic dispatch or claim_task). */
export function isClaimable(task: Pick<DispatchCandidate, "status" | "onHold">): boolean {
  return !task.onHold && (task.status === "todo" || task.status === "changes_requested");
}

/** The next task the auto-dispatcher should start, or null. */
export function pickNextTask<T extends DispatchCandidate>(ctx: DispatchContext, tasks: T[]): T | null {
  if (projectDispatchBlocker(ctx)) return null;
  return tasks.filter(isClaimable).sort(compareForDispatch)[0] ?? null;
}

export function formatTaskKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

export function branchNameFor(projectKey: string, number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `agent/${formatTaskKey(projectKey, number)}${slug ? `-${slug}` : ""}`;
}
