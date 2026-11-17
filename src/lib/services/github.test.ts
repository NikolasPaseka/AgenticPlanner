import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import type { GitHubGateway } from "@/lib/github/gateway";
import { signGitHubBody, verifyGitHubSignature } from "@/lib/github/webhook-signature";
import { createTestDb } from "@/test/db";
import type { Actor } from "./actor";
import { ConflictError, ValidationError } from "./errors";
import {
  approveAndMerge,
  connectRepository,
  countReviewQueue,
  extractTaskNumber,
  handleGitHubEvent,
  recordDelivery,
  rejectTask,
  requestChanges,
} from "./github";
import { createProject, updateProjectSettings, type Project } from "./projects";
import { createTask, getTaskByNumber, getTimeline, transitionTask } from "./tasks";

const owner: Actor = { kind: "owner", name: "octocat" };
const agent: Actor = { kind: "agent", name: "claude-dev" };

function fakeGitHub(overrides: Partial<GitHubGateway> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const pr = { state: "open" as const, merged: false, mergeable: true, headRef: "agent/AP-1-x", headSha: "abc123", htmlUrl: "https://github.com/o/r/pull/7" };
  const base: GitHubGateway = {
    findInstallation: async () => 99,
    getPullRequest: async () => pr,
    mergePullRequest: async () => ({ sha: "merge999" }),
    closePullRequest: async () => undefined,
    comment: async () => undefined,
    deleteBranch: async () => undefined,
    dispatchWorkflow: async () => undefined,
    cancelWorkflowRun: async () => undefined,
  };
  const gw = Object.fromEntries(
    Object.entries({ ...base, ...overrides }).map(([name, fn]) => [
      name,
      (...args: unknown[]) => {
        calls.push({ name, args });
        return (fn as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as GitHubGateway;
  return { gw, calls };
}

let db: Db;
let project: Project;

beforeEach(async () => {
  vi.stubEnv("OWNER_GITHUB_LOGINS", "octocat");
  db = await createTestDb();
  project = await createProject(db, { name: "Planner", key: "AP", githubOwner: "Octo", githubRepo: "Planner" });
});

async function taskInReview(prNumber = 7) {
  const t = await createTask(db, project.id, { title: "Add login" }, owner);
  await transitionTask(db, t.id, "in_progress", agent);
  await transitionTask(db, t.id, "in_review", agent);
  await handleGitHubEvent(db, "pull_request", prPayload("opened", { number: prNumber }));
  return getTaskByNumber(db, project.id, t.number);
}

function prPayload(action: string, pr: Partial<{ number: number; body: string; title: string; ref: string; sha: string; merged: boolean; merged_by: string }> = {}) {
  return {
    action,
    installation: { id: 99 },
    repository: { name: "planner", owner: { login: "octo" } },
    pull_request: {
      number: pr.number ?? 7,
      title: pr.title ?? "Add login",
      body: pr.body ?? "Implements it.\n\nAgentPlanner: AP-1",
      html_url: `https://github.com/octo/planner/pull/${pr.number ?? 7}`,
      head: { ref: pr.ref ?? "agent/AP-1-add-login", sha: pr.sha ?? "abc123" },
      merged: pr.merged ?? false,
      merged_by: pr.merged_by ? { login: pr.merged_by } : null,
      merge_commit_sha: pr.merged ? "m1" : null,
      merged_at: pr.merged ? new Date().toISOString() : null,
    },
  };
}

describe("webhook signature", () => {
  it("accepts the right signature only", () => {
    const sig = signGitHubBody("s3cret", '{"a":1}');
    expect(verifyGitHubSignature("s3cret", '{"a":1}', sig)).toBe(true);
    expect(verifyGitHubSignature("s3cret", '{"a":2}', sig)).toBe(false);
    expect(verifyGitHubSignature("other", '{"a":1}', sig)).toBe(false);
    expect(verifyGitHubSignature("s3cret", '{"a":1}', null)).toBe(false);
  });

  it("deduplicates deliveries", async () => {
    expect(await recordDelivery(db, "d1", "github")).toBe(true);
    expect(await recordDelivery(db, "d1", "github")).toBe(false);
  });
});

describe("linking PRs", () => {
  it("finds the task key in body, title, or branch", () => {
    expect(extractTaskNumber("AP", { body: "x\nAgentPlanner: AP-12" })).toBe(12);
    expect(extractTaskNumber("AP", { title: "AP-3: Fix" })).toBe(3);
    expect(extractTaskNumber("AP", { title: "[AP-4] Fix" })).toBe(4);
    expect(extractTaskNumber("AP", { branch: "agent/AP-5-add-x" })).toBe(5);
    expect(extractTaskNumber("AP", { branch: "nikolas/AP-6" })).toBe(6);
    expect(extractTaskNumber("AP", { title: "Fix AP-2 later", branch: "main" })).toBeNull();
    expect(extractTaskNumber("AP", { title: "APX-1" })).toBeNull();
  });

  it("links an opened PR, stores the installation, and tracks new commits", async () => {
    const t = await taskInReview();
    expect(t).toMatchObject({ prNumber: 7, prHeadSha: "abc123", branchName: "agent/AP-1-add-login", checksStatus: "pending" });
    const [p] = await db.query.projects.findMany();
    expect(p.githubInstallationId).toBe(99);
    await handleGitHubEvent(db, "pull_request", prPayload("synchronize", { sha: "def456" }));
    expect((await getTaskByNumber(db, project.id, 1)).prHeadSha).toBe("def456");
  });

  it("ignores unknown repositories and unreferenced PRs", async () => {
    const other = { ...prPayload("opened"), repository: { name: "x", owner: { login: "y" } } };
    expect(await handleGitHubEvent(db, "pull_request", other)).toBe("no project for repository");
    expect(await handleGitHubEvent(db, "pull_request", prPayload("opened", { body: "", title: "Hi", ref: "main" }))).toBe(
      "no task referenced",
    );
  });

  it("tracks checks for the current head commit", async () => {
    await taskInReview();
    const suite = (action: string, conclusion: string | null, sha = "abc123") => ({
      action,
      repository: { name: "planner", owner: { login: "octo" } },
      check_suite: { head_sha: sha, conclusion, pull_requests: [{ number: 7 }] },
    });
    await handleGitHubEvent(db, "check_suite", suite("completed", "success"));
    expect((await getTaskByNumber(db, project.id, 1)).checksStatus).toBe("success");
    await handleGitHubEvent(db, "check_suite", suite("completed", "failure", "old-sha"));
    expect((await getTaskByNumber(db, project.id, 1)).checksStatus).toBe("success");
    await handleGitHubEvent(db, "check_suite", suite("completed", "failure"));
    expect((await getTaskByNumber(db, project.id, 1)).checksStatus).toBe("failure");
  });

  it("marks merged only when an owner merged on GitHub", async () => {
    await taskInReview();
    await handleGitHubEvent(db, "pull_request", prPayload("closed", { merged: true, merged_by: "someone-else" }));
    expect((await getTaskByNumber(db, project.id, 1)).status).toBe("in_review");
    await handleGitHubEvent(db, "pull_request", prPayload("closed", { merged: true, merged_by: "OctoCat" }));
    expect((await getTaskByNumber(db, project.id, 1)).status).toBe("merged");
  });

  it("stores and clears installations", async () => {
    await handleGitHubEvent(db, "installation", {
      action: "created",
      installation: { id: 5 },
      repositories: [{ full_name: "octo/planner" }],
    });
    expect((await db.query.projects.findFirst())?.githubInstallationId).toBe(5);
    await handleGitHubEvent(db, "installation", { action: "deleted", installation: { id: 5 }, repositories: [] });
    expect((await db.query.projects.findFirst())?.githubInstallationId).toBeNull();
  });
});

describe("owner review actions", () => {
  it("connects the repository through the App installation", async () => {
    const { gw } = fakeGitHub();
    expect(await connectRepository(db, gw, project.id, owner)).toBe(99);
    const { gw: missing } = fakeGitHub({ findInstallation: async () => null });
    await expect(connectRepository(db, missing, project.id, owner)).rejects.toThrow(/not installed/);
  });

  it("approves: merges with the project's method and the reviewed commit", async () => {
    const t = await taskInReview();
    expect(await countReviewQueue(db, project.id)).toBe(1);
    const { gw, calls } = fakeGitHub();
    const merged = await approveAndMerge(db, gw, t.id, "abc123", owner);
    expect(merged.status).toBe("merged");
    const merge = calls.find((c) => c.name === "mergePullRequest")!;
    expect(merge.args.slice(0, 4)).toEqual([99, "Octo", "Planner", 7]);
    expect(merge.args[4]).toMatchObject({ method: "merge", sha: "abc123", title: "AP-1: Add login (#7)" });
    expect(calls.some((c) => c.name === "deleteBranch")).toBe(true);
    const after = await getTaskByNumber(db, project.id, 1);
    expect(after).toMatchObject({ mergeCommitSha: "merge999" });
    expect(after.mergedAt).not.toBeNull();
  });

  it("uses squash when configured", async () => {
    await updateProjectSettings(db, project.id, {
      name: "Planner",
      githubOwner: "Octo",
      githubRepo: "Planner",
      defaultBranch: "main",
      autoDispatch: true,
      maxParallelRuns: 1,
      maxProposalsPerRun: 5,
      mergeMethod: "squash",
    });
    const t = await taskInReview();
    const { gw, calls } = fakeGitHub();
    await approveAndMerge(db, gw, t.id, null, owner);
    expect(calls.find((c) => c.name === "mergePullRequest")!.args[4]).toMatchObject({ method: "squash" });
  });

  it("refuses to merge after new commits, failing checks, conflicts, or for non-owners", async () => {
    const t = await taskInReview();
    const { gw } = fakeGitHub();
    await expect(approveAndMerge(db, gw, t.id, "stale", owner)).rejects.toThrow(/New commits/);
    await expect(approveAndMerge(db, gw, t.id, "abc123", agent)).rejects.toBeInstanceOf(ValidationError);
    const { gw: conflicted } = fakeGitHub({
      getPullRequest: async () => ({ state: "open", merged: false, mergeable: false, headRef: "x", headSha: "abc123", htmlUrl: "" }),
    });
    await expect(approveAndMerge(db, conflicted, t.id, "abc123", owner)).rejects.toThrow(/conflicts/);
    await handleGitHubEvent(db, "check_suite", {
      action: "completed",
      repository: { name: "planner", owner: { login: "octo" } },
      check_suite: { head_sha: "abc123", conclusion: "failure", pull_requests: [{ number: 7 }] },
    });
    await expect(approveAndMerge(db, gw, t.id, "abc123", owner)).rejects.toBeInstanceOf(ConflictError);
  });

  it("request changes comments on the PR and sends the task back", async () => {
    const t = await taskInReview();
    const { gw, calls } = fakeGitHub();
    await requestChanges(db, gw, t.id, "Add tests please", owner);
    expect((await getTaskByNumber(db, project.id, 1)).status).toBe("changes_requested");
    expect(calls.find((c) => c.name === "comment")!.args[4]).toContain("Add tests please");
    const last = (await getTimeline(db, t.id)).at(-1);
    expect(last?.kind === "comment" && last.comment.body).toContain("Add tests please");
    await expect(requestChanges(db, gw, t.id, "  ", owner)).rejects.toThrow();
  });

  it("request changes still works when GitHub fails", async () => {
    const t = await taskInReview();
    const { gw } = fakeGitHub({ comment: async () => { throw new Error("boom"); } });
    const res = await requestChanges(db, gw, t.id, "Fix it", owner);
    expect(res.warning).toBeTruthy();
    expect((await getTaskByNumber(db, project.id, 1)).status).toBe("changes_requested");
  });

  it("reject closes the PR and cancels or resets the task", async () => {
    const t = await taskInReview();
    const { gw, calls } = fakeGitHub();
    await rejectTask(db, gw, t.id, "todo", "Wrong approach", owner);
    const after = await getTaskByNumber(db, project.id, 1);
    expect(after).toMatchObject({ status: "todo", prNumber: null });
    expect(calls.map((c) => c.name)).toEqual(expect.arrayContaining(["comment", "closePullRequest"]));
  });
});
