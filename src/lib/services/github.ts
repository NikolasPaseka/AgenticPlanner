import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { projects, taskEvents, tasks, webhookDeliveries } from "@/lib/db/schema";
import type { GitHubGateway } from "@/lib/github/gateway";
import { formatTaskKey } from "@/lib/domain/tasks";
import { isOwnerLogin } from "./owners";
import type { Actor } from "./actor";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import type { Project } from "./projects";
import { handleWorkflowRun } from "./dispatch";
import { addComment, transitionTask, type Task } from "./tasks";

// ---------------------------------------------------------------------------
// Linking pull requests to tasks
// ---------------------------------------------------------------------------

/**
 * Finds the task number a PR refers to. Checked in order: an "AgentPlanner: KEY-n"
 * line in the body, a "KEY-n" prefix in the title, an "agent/KEY-n-..." branch.
 */
export function extractTaskNumber(
  projectKey: string,
  pr: { title?: string | null; body?: string | null; branch?: string | null },
): number | null {
  const k = projectKey.toUpperCase();
  const patterns: [string | null | undefined, RegExp][] = [
    [pr.body, new RegExp(`AgentPlanner:\\s*${k}-(\\d+)\\b`, "i")],
    [pr.title, new RegExp(`^\\s*\\[?${k}-(\\d+)\\b`, "i")],
    [pr.branch, new RegExp(`^(?:[\\w.-]+/)?${k}-(\\d+)(?:-|$)`, "i")],
  ];
  for (const [text, re] of patterns) {
    const m = text?.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

async function findProjectByRepo(db: Db, owner: string, repo: string): Promise<Project | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(sql`lower(${projects.githubOwner}) = lower(${owner})`, sql`lower(${projects.githubRepo}) = lower(${repo})`));
  return project ?? null;
}

async function findTask(db: Db, projectId: string, by: { number?: number | null; prNumber?: number }): Promise<Task | null> {
  const where = by.number
    ? and(eq(tasks.projectId, projectId), eq(tasks.number, by.number))
    : by.prNumber
      ? and(eq(tasks.projectId, projectId), eq(tasks.prNumber, by.prNumber))
      : null;
  if (!where) return null;
  const [task] = await db.select().from(tasks).where(where);
  return task ?? null;
}

const SYSTEM: Actor = { kind: "system", name: "github" };

async function event(db: Db, taskId: string, actor: Actor, type: string, payload: Record<string, unknown>) {
  await db.insert(taskEvents).values({
    taskId,
    actorType: actor.kind === "owner" ? "user" : actor.kind,
    actor: actor.name,
    type,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Records a delivery id. Returns false if it was already processed. */
export async function recordDelivery(db: Db, id: string, source: string): Promise<boolean> {
  const rows = await db.insert(webhookDeliveries).values({ id, source }).onConflictDoNothing().returning();
  return rows.length > 0;
}

type Repo = { name: string; owner: { login: string } };
type PullRequestPayload = {
  action: string;
  installation?: { id: number };
  repository: Repo;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    head: { ref: string; sha: string };
    merged?: boolean;
    merged_by?: { login: string } | null;
    merge_commit_sha?: string | null;
    merged_at?: string | null;
  };
};
type CheckSuitePayload = {
  action: string;
  repository: Repo;
  check_suite: { head_sha: string; conclusion: string | null; pull_requests: { number: number }[] };
};
type InstallationPayload = {
  action: string;
  installation: { id: number };
  repositories?: { full_name: string }[];
  repositories_added?: { full_name: string }[];
  repositories_removed?: { full_name: string }[];
};

const FAILING = new Set(["failure", "timed_out", "action_required", "startup_failure", "cancelled"]);

/**
 * Applies a GitHub webhook to tasks. Returns a short description for logs.
 * Unknown events and repositories are ignored.
 */
export async function handleGitHubEvent(db: Db, name: string, payload: unknown): Promise<string> {
  switch (name) {
    case "pull_request":
      return handlePullRequest(db, payload as PullRequestPayload);
    case "check_suite":
      return handleCheckSuite(db, payload as CheckSuitePayload);
    case "installation":
    case "installation_repositories":
      return handleInstallation(db, payload as InstallationPayload);
    case "workflow_run":
      return handleWorkflowRun(db, payload as Parameters<typeof handleWorkflowRun>[1]);
    case "ping":
      return "pong";
    default:
      return `ignored ${name}`;
  }
}

async function handlePullRequest(db: Db, p: PullRequestPayload): Promise<string> {
  const project = await findProjectByRepo(db, p.repository.owner.login, p.repository.name);
  if (!project) return "no project for repository";
  if (p.installation?.id && !project.githubInstallationId) {
    await db.update(projects).set({ githubInstallationId: p.installation.id }).where(eq(projects.id, project.id));
  }
  const pr = p.pull_request;
  const number = extractTaskNumber(project.key, { title: pr.title, body: pr.body, branch: pr.head.ref });
  const task =
    (await findTask(db, project.id, { number })) ?? (await findTask(db, project.id, { prNumber: pr.number }));
  if (!task) return "no task referenced";
  const key = formatTaskKey(project.key, task.number);

  if (["opened", "reopened", "edited", "synchronize", "ready_for_review"].includes(p.action)) {
    const isNewLink = task.prNumber !== pr.number;
    await db
      .update(tasks)
      .set({
        prNumber: pr.number,
        prUrl: pr.html_url,
        prHeadSha: pr.head.sha,
        branchName: task.branchName ?? pr.head.ref,
        ...(task.prHeadSha !== pr.head.sha ? { checksStatus: "pending" } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(tasks.id, task.id));
    if (isNewLink) await event(db, task.id, SYSTEM, "pr_linked", { prNumber: pr.number, url: pr.html_url });
    else if (p.action === "synchronize") await event(db, task.id, SYSTEM, "pr_updated", { sha: pr.head.sha.slice(0, 7) });
    return `${key} linked to PR #${pr.number}`;
  }

  if (p.action === "closed" && pr.merged) {
    await db
      .update(tasks)
      .set({
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : sql`now()`,
        mergeCommitSha: pr.merge_commit_sha ?? null,
      })
      .where(eq(tasks.id, task.id));
    if (task.status === "merged" || task.status === "done") return `${key} already merged`;
    // Merged directly on GitHub. Only count it as an approval if an owner pressed the button.
    const mergedBy = pr.merged_by?.login;
    if (task.status === "in_review" && isOwnerLogin(mergedBy)) {
      await transitionTask(db, task.id, "merged", { kind: "owner", name: mergedBy! }, { prNumber: pr.number, via: "github" });
      return `${key} merged on GitHub by ${mergedBy}`;
    }
    await event(db, task.id, SYSTEM, "pr_merged_outside", { prNumber: pr.number, mergedBy: mergedBy ?? null });
    return `${key} PR merged outside the review flow`;
  }

  if (p.action === "closed") {
    await event(db, task.id, SYSTEM, "pr_closed", { prNumber: pr.number });
    return `${key} PR closed`;
  }
  return `ignored pull_request.${p.action}`;
}

async function handleCheckSuite(db: Db, p: CheckSuitePayload): Promise<string> {
  const project = await findProjectByRepo(db, p.repository.owner.login, p.repository.name);
  if (!project) return "no project for repository";
  const suite = p.check_suite;
  let updated = 0;
  for (const { number } of suite.pull_requests) {
    const task = await findTask(db, project.id, { prNumber: number });
    if (!task || (task.prHeadSha && task.prHeadSha !== suite.head_sha)) continue;
    let next = task.checksStatus;
    if (p.action === "completed") {
      if (suite.conclusion && FAILING.has(suite.conclusion)) next = "failure";
      else if (task.checksStatus !== "failure") next = "success";
    } else if (task.checksStatus !== "failure") {
      next = "pending";
    }
    if (next !== task.checksStatus) {
      await db.update(tasks).set({ checksStatus: next }).where(eq(tasks.id, task.id));
      await event(db, task.id, SYSTEM, "checks_updated", { status: next });
      updated++;
    }
  }
  return `checks updated on ${updated} task(s)`;
}

async function handleInstallation(db: Db, p: InstallationPayload): Promise<string> {
  const added = p.action === "deleted" ? [] : [...(p.repositories ?? []), ...(p.repositories_added ?? [])];
  const removed = p.action === "deleted" ? (p.repositories ?? []) : (p.repositories_removed ?? []);
  let n = 0;
  for (const { full_name } of added) {
    const [owner, repo] = full_name.split("/");
    const project = await findProjectByRepo(db, owner, repo);
    if (project) {
      await db.update(projects).set({ githubInstallationId: p.installation.id }).where(eq(projects.id, project.id));
      n++;
    }
  }
  for (const { full_name } of removed) {
    const [owner, repo] = full_name.split("/");
    const project = await findProjectByRepo(db, owner, repo);
    if (project) {
      await db.update(projects).set({ githubInstallationId: null }).where(eq(projects.id, project.id));
      n++;
    }
  }
  if (p.action === "deleted") {
    await db
      .update(projects)
      .set({ githubInstallationId: null })
      .where(eq(projects.githubInstallationId, p.installation.id));
  }
  return `installation ${p.action}: ${n} project(s) updated`;
}

// ---------------------------------------------------------------------------
// Owner review actions
// ---------------------------------------------------------------------------

function repoOf(project: Project) {
  if (!project.githubOwner || !project.githubRepo) {
    throw new ValidationError("Set the GitHub owner and repository in project settings first");
  }
  if (!project.githubInstallationId) {
    throw new ValidationError("Install the GitHub App on the repository and click Connect in project settings");
  }
  return { installationId: project.githubInstallationId, owner: project.githubOwner, repo: project.githubRepo };
}

async function loadTask(db: Db, taskId: string): Promise<{ task: Task; project: Project }> {
  const [row] = await db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId));
  if (!row) throw new NotFoundError("Task");
  return row;
}

/** Looks up the App installation for the project's repository and stores it. */
export async function connectRepository(db: Db, gh: GitHubGateway, projectId: string, actor: Actor) {
  if (actor.kind !== "owner") throw new ValidationError("Only the owner can connect repositories");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new NotFoundError("Project");
  if (!project.githubOwner || !project.githubRepo) {
    throw new ValidationError("Set the GitHub owner and repository first");
  }
  const id = await gh.findInstallation(project.githubOwner, project.githubRepo);
  if (!id) {
    throw new ValidationError(
      `The GitHub App is not installed on ${project.githubOwner}/${project.githubRepo}. Install it, then try again.`,
    );
  }
  await db.update(projects).set({ githubInstallationId: id }).where(eq(projects.id, projectId));
  return id;
}

/**
 * Merges the task's PR, then marks the task merged. `reviewedSha` is the head commit
 * the owner saw; GitHub refuses the merge if new commits arrived since.
 */
export async function approveAndMerge(
  db: Db,
  gh: GitHubGateway,
  taskId: string,
  reviewedSha: string | null,
  actor: Actor,
) {
  if (actor.kind !== "owner") throw new ValidationError("Only the owner can merge");
  const { task, project } = await loadTask(db, taskId);
  if (task.status !== "in_review") throw new ConflictError("Only tasks in review can be approved");
  if (!task.prNumber) throw new ConflictError("No pull request is linked to this task");
  const { installationId, owner, repo } = repoOf(project);

  const pr = await gh.getPullRequest(installationId, owner, repo, task.prNumber);
  let sha: string;
  if (pr.merged) {
    sha = pr.headSha;
  } else {
    if (pr.state === "closed") throw new ConflictError("The pull request is closed");
    if (reviewedSha && pr.headSha !== reviewedSha) {
      throw new ConflictError("New commits were pushed since you opened this review. Reload and review again.");
    }
    if (task.checksStatus === "failure") throw new ConflictError("Checks are failing. Request changes instead.");
    if (pr.mergeable === false) throw new ConflictError("The pull request has merge conflicts.");
    const key = formatTaskKey(project.key, task.number);
    const merged = await gh.mergePullRequest(installationId, owner, repo, task.prNumber, {
      method: project.settings.mergeMethod,
      title: `${key}: ${task.title} (#${task.prNumber})`,
      sha: pr.headSha,
    });
    sha = merged.sha;
  }

  const result = await transitionTask(db, task.id, "merged", actor, { prNumber: task.prNumber, sha });
  await db
    .update(tasks)
    .set({ mergedAt: sql`now()`, mergeCommitSha: sha })
    .where(eq(tasks.id, task.id));
  if (task.branchName?.startsWith("agent/") && !pr.merged) {
    await gh.deleteBranch(installationId, owner, repo, task.branchName).catch(() => undefined);
  }
  return result;
}

/** Sends a task in review back to the developer with the owner's feedback. */
export async function requestChanges(
  db: Db,
  gh: GitHubGateway | null,
  taskId: string,
  feedback: string,
  actor: Actor,
): Promise<{ warning?: string }> {
  const text = feedback.trim();
  if (!text) throw new ValidationError("Write what needs to change");
  const { task, project } = await loadTask(db, taskId);
  await transitionTask(db, task.id, "changes_requested", actor, { via: "review" });
  await addComment(db, task.id, { body: `Changes requested:\n\n${text}` }, actor);
  if (task.prNumber && project.githubInstallationId && gh) {
    try {
      const { installationId, owner, repo } = repoOf(project);
      await gh.comment(installationId, owner, repo, task.prNumber, `**Changes requested in AgentPlanner**\n\n${text}`);
    } catch {
      return { warning: "Saved, but the comment could not be posted on GitHub." };
    }
  }
  return {};
}

/** Closes the PR and cancels the task or sends it back to Todo. */
export async function rejectTask(
  db: Db,
  gh: GitHubGateway | null,
  taskId: string,
  mode: "cancel" | "todo",
  reason: string,
  actor: Actor,
): Promise<{ warning?: string }> {
  const { task, project } = await loadTask(db, taskId);
  await transitionTask(db, task.id, mode === "cancel" ? "cancelled" : "todo", actor, { via: "reject" });
  if (reason.trim()) await addComment(db, task.id, { body: `Rejected: ${reason.trim()}` }, actor);
  if (task.prNumber && project.githubInstallationId && gh) {
    try {
      const { installationId, owner, repo } = repoOf(project);
      if (reason.trim()) await gh.comment(installationId, owner, repo, task.prNumber, `Rejected in AgentPlanner: ${reason.trim()}`);
      await gh.closePullRequest(installationId, owner, repo, task.prNumber);
    } catch {
      return { warning: "Saved, but the pull request could not be closed on GitHub." };
    }
  }
  if (mode === "todo") {
    // A fresh attempt starts from a clean slate.
    await db
      .update(tasks)
      .set({ prNumber: null, prUrl: null, prHeadSha: null, checksStatus: null, previewUrl: null })
      .where(eq(tasks.id, task.id));
  }
  return {};
}

export async function listReviewQueue(db: Db, projectId: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, "in_review")))
    .orderBy(tasks.updatedAt);
}

export async function countReviewQueue(db: Db, projectId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, "in_review"), isNull(tasks.mergedAt)));
  return row?.n ?? 0;
}
