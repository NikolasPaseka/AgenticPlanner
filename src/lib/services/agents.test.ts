import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { InvalidTransitionError } from "@/lib/domain/tasks";
import { createTestDb } from "@/test/db";
import type { Actor } from "./actor";
import {
  agentClaimTask,
  agentContext,
  agentFinishRun,
  agentGetTask,
  agentLinkBranch,
  agentListTasks,
  agentProposeTask,
  agentRecordReview,
  agentReportBlocked,
  agentSubmitForReview,
  ForbiddenError,
  listRunsForTask,
  parseTaskKey,
  type AgentContext,
} from "./agents";
import { ConflictError } from "./errors";
import { createProject, updateProjectSettings, type Project } from "./projects";
import { setAgentsEnabled } from "./settings";
import { createTask, getTaskByNumber, setTaskHold, transitionTask } from "./tasks";
import { authenticateToken, createApiToken, listApiTokens, revokeApiToken } from "./tokens";

const owner: Actor = { kind: "owner", name: "octocat" };
const ALL = ["tasks:read", "tasks:write", "tasks:propose", "reviews:write"];

let db: Db;
let project: Project;
let ctx: AgentContext;

async function tokenCtx(scopes = ALL, name = "claude-dev") {
  const { token } = await createApiToken(db, project.id, { name, scopes }, owner);
  const auth = await authenticateToken(db, token);
  return agentContext(auth!.project, auth!.token);
}

beforeEach(async () => {
  db = await createTestDb();
  project = await createProject(db, { name: "Planner", key: "AP" });
  ctx = await tokenCtx();
});

describe("API tokens", () => {
  it("stores only a hash and authenticates the raw token", async () => {
    const { token, record } = await createApiToken(db, project.id, { name: "bot", scopes: ["tasks:read"] }, owner);
    expect(token).toMatch(/^ap_/);
    expect(record.tokenHash).not.toContain(token);
    expect((await authenticateToken(db, token))?.project.id).toBe(project.id);
    expect(await authenticateToken(db, "ap_wrong")).toBeNull();
    expect(await authenticateToken(db, null)).toBeNull();
  });

  it("rejects revoked tokens and records last use", async () => {
    const { token, record } = await createApiToken(db, project.id, { name: "bot", scopes: ["tasks:read"] }, owner);
    await authenticateToken(db, token);
    const [listed] = (await listApiTokens(db, project.id)).filter((t) => t.id === record.id);
    expect(listed.lastUsedAt).not.toBeNull();
    await revokeApiToken(db, record.id, owner);
    expect(await authenticateToken(db, token)).toBeNull();
  });

  it("validates names and scopes, and only the owner manages tokens", async () => {
    await expect(createApiToken(db, project.id, { name: "bad name", scopes: ALL }, owner)).rejects.toThrow();
    await expect(createApiToken(db, project.id, { name: "x", scopes: [] }, owner)).rejects.toThrow();
    await expect(
      createApiToken(db, project.id, { name: "x", scopes: ALL }, { kind: "agent", name: "x" }),
    ).rejects.toThrow();
  });
});

describe("agent operations", () => {
  it("parses task keys for its project only", () => {
    expect(parseTaskKey(project, "AP-12")).toBe(12);
    expect(parseTaskKey(project, "ap-3")).toBe(3);
    expect(parseTaskKey(project, "7")).toBe(7);
    expect(() => parseTaskKey(project, "XY-1")).toThrow();
  });

  it("runs the developer workflow end to end", async () => {
    await createTask(db, project.id, { title: "Add login", acceptanceCriteria: "- works" }, owner);
    const listed = await agentListTasks(db, ctx, { status: "todo" });
    expect(listed.map((t) => t.key)).toEqual(["AP-1"]);

    const { task, runId } = await agentClaimTask(db, ctx, "AP-1");
    expect(task.status).toBe("in_progress");
    await agentLinkBranch(db, ctx, "AP-1", "agent/AP-1-add-login");
    await agentSubmitForReview(db, ctx, "AP-1", { summary: "Done, tests pass", prNumber: 5, prUrl: "https://github.com/o/r/pull/5" });
    await agentFinishRun(db, ctx, runId, { status: "succeeded", costUsd: 0.42 });

    const detail = await agentGetTask(db, ctx, "AP-1");
    expect(detail).toMatchObject({ status: "in_review", branch: "agent/AP-1-add-login", pullRequest: { number: 5 } });
    expect(detail.comments.at(-1)?.body).toBe("Done, tests pass");
    const t = await getTaskByNumber(db, project.id, 1);
    expect(t.assignee).toBe("claude-dev");
    const [run] = await listRunsForTask(db, t.id);
    expect(run).toMatchObject({ status: "succeeded", agent: "claude-dev", costUsd: "0.4200" });
  });

  it("refuses claims when paused, on hold, or already taken", async () => {
    const t = await createTask(db, project.id, { title: "One" }, owner);
    await setAgentsEnabled(db, false, owner);
    await expect(agentClaimTask(db, ctx, "AP-1")).rejects.toThrow(/paused/);
    await setAgentsEnabled(db, true, owner);

    await setTaskHold(db, t.id, true, owner);
    await expect(agentClaimTask(db, ctx, "AP-1")).rejects.toThrow(/on hold/);
    await setTaskHold(db, t.id, false, owner);

    await agentClaimTask(db, ctx, "AP-1");
    const other = await tokenCtx(ALL, "other-agent");
    await expect(agentClaimTask(db, other, "AP-1")).rejects.toBeInstanceOf(ConflictError);
  });

  it("enforces token scopes", async () => {
    await createTask(db, project.id, { title: "One" }, owner);
    const readOnly = await tokenCtx(["tasks:read"], "reader");
    await expect(agentListTasks(db, readOnly, {})).resolves.toHaveLength(1);
    await expect(agentClaimTask(db, readOnly, "AP-1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(agentProposeTask(db, readOnly, { title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(agentRecordReview(db, readOnly, "AP-1", { verdict: "comment" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot see other projects' tasks", async () => {
    const other = await createProject(db, { name: "Other", key: "OT" });
    await createTask(db, other.id, { title: "Secret" }, owner);
    await expect(agentGetTask(db, ctx, "OT-1")).rejects.toThrow();
    await expect(agentGetTask(db, ctx, "1")).rejects.toThrow(/not found/);
  });

  it("can never merge or accept proposals", async () => {
    const t = await createTask(db, project.id, { title: "One" }, owner);
    await agentClaimTask(db, ctx, "AP-1");
    await agentSubmitForReview(db, ctx, "AP-1", { summary: "done" });
    await expect(transitionTask(db, t.id, "merged", ctx.actor)).rejects.toBeInstanceOf(InvalidTransitionError);
    const proposal = await agentProposeTask(db, ctx, { title: "Idea" });
    expect(proposal.status).toBe("proposed");
    const p = await getTaskByNumber(db, project.id, 2);
    await expect(transitionTask(db, p.id, "todo", ctx.actor)).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("limits proposals per run and per hour", async () => {
    await updateProjectSettings(db, project.id, {
      name: "Planner",
      defaultBranch: "main",
      autoDispatch: true,
      maxParallelRuns: 1,
      maxProposalsPerRun: 2,
      mergeMethod: "merge",
    });
    ctx = await tokenCtx(ALL, "analyzer");
    await agentProposeTask(db, ctx, { title: "A" });
    await agentProposeTask(db, ctx, { title: "B", parentKey: "AP-1" });
    await expect(agentProposeTask(db, ctx, { title: "C" })).rejects.toThrow(/limit/);
  });

  it("request_changes from a reviewer sends the task back", async () => {
    await createTask(db, project.id, { title: "One" }, owner);
    await agentClaimTask(db, ctx, "AP-1");
    await agentSubmitForReview(db, ctx, "AP-1", { summary: "done" });
    const reviewer = await tokenCtx(ALL, "claude-review");
    await agentRecordReview(db, reviewer, "AP-1", {
      verdict: "request_changes",
      body: "Missing tests",
      findings: [{ severity: "major", file: "src/a.ts", line: 3, message: "No test" }],
    });
    const detail = await agentGetTask(db, ctx, "AP-1");
    expect(detail.status).toBe("changes_requested");
    expect(detail.latestReview?.findings).toHaveLength(1);
    // The developer can pick it up again.
    await expect(agentClaimTask(db, ctx, "AP-1")).resolves.toMatchObject({ task: { status: "in_progress" } });
  });

  it("reports blocked with a question", async () => {
    await createTask(db, project.id, { title: "One" }, owner);
    await agentClaimTask(db, ctx, "AP-1");
    await agentReportBlocked(db, ctx, "AP-1", "Which OAuth provider?");
    const detail = await agentGetTask(db, ctx, "AP-1");
    expect(detail.status).toBe("blocked");
    expect(detail.comments.at(-1)?.body).toContain("Which OAuth provider?");
  });
});
