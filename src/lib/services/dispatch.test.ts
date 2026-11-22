import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import type { GitHubGateway } from "@/lib/github/gateway";
import { createTestDb } from "@/test/db";
import type { Actor } from "./actor";
import { agentClaimTask, agentContext, agentRecordReview, agentSubmitForReview, REVIEW_ROUNDS_LIMIT } from "./agents";
import { dispatchAll, dispatchNext, dispatchTask, handleWorkflowRun, listRuns, stopRun } from "./dispatch";
import { connectRepository } from "./github";
import { createProject, getProjectBySlug, updateProjectSettings, type Project } from "./projects";
import { setAgentsEnabled } from "./settings";
import { createTask, getTaskByNumber, getTimeline, setTaskHold } from "./tasks";
import { authenticateToken, createApiToken } from "./tokens";

const owner: Actor = { kind: "owner", name: "octocat" };

function fakeGitHub(fail = false) {
  const calls: { name: string; args: unknown[] }[] = [];
  const gw = {
    findInstallation: async () => 7,
    dispatchWorkflow: async (...args: unknown[]) => {
      calls.push({ name: "dispatchWorkflow", args });
      if (fail) throw new Error("workflow not found");
    },
    cancelWorkflowRun: async (...args: unknown[]) => {
      calls.push({ name: "cancelWorkflowRun", args });
    },
  } as unknown as GitHubGateway;
  return { gw, calls };
}

let db: Db;
let project: Project;

async function settings(patch: Partial<Project["settings"]>) {
  const p = await getProjectBySlug(db, project.slug);
  await updateProjectSettings(db, p.id, {
    name: p.name,
    githubOwner: p.githubOwner,
    githubRepo: p.githubRepo,
    defaultBranch: p.defaultBranch,
    ...p.settings,
    ...patch,
  });
  project = await getProjectBySlug(db, project.slug);
}

beforeEach(async () => {
  db = await createTestDb();
  project = await createProject(db, { name: "Planner", key: "AP", githubOwner: "octo", githubRepo: "planner" });
  await connectRepository(db, fakeGitHub().gw, project.id, owner);
  project = await getProjectBySlug(db, project.slug);
});

describe("dispatcher", () => {
  it("starts the highest-priority todo task with its run id", async () => {
    await createTask(db, project.id, { title: "Low", priority: "low" }, owner);
    await createTask(db, project.id, { title: "Urgent", priority: "urgent" }, owner);
    const { gw, calls } = fakeGitHub();
    const run = await dispatchNext(db, gw, project);
    expect(run).not.toBeNull();
    expect(calls[0].args).toEqual([7, "octo", "planner", "agentplanner-develop.yml", "main", { task_key: "AP-2", run_id: run!.id }]);
    expect((await getTaskByNumber(db, project.id, 2)).status).toBe("in_progress");
    // One slot by default: nothing else starts.
    expect(await dispatchNext(db, gw, project)).toBeNull();
  });

  it("respects the global switch, auto-dispatch, holds, and the parallel limit", async () => {
    const a = await createTask(db, project.id, { title: "A", priority: "high" }, owner);
    await createTask(db, project.id, { title: "B" }, owner);
    const { gw, calls } = fakeGitHub();

    await setAgentsEnabled(db, false, owner);
    expect(await dispatchAll(db, gw)).toBe(0);
    await setAgentsEnabled(db, true, owner);

    await settings({ autoDispatch: false });
    expect(await dispatchAll(db, gw)).toBe(0);
    await settings({ autoDispatch: true, maxParallelRuns: 2 });

    await setTaskHold(db, a.id, true, owner);
    expect(await dispatchAll(db, gw)).toBe(1);
    expect(calls.map((c) => (c.args[5] as { task_key: string }).task_key)).toEqual(["AP-2"]);
  });

  it("does nothing for projects without a connected repository", async () => {
    const other = await createProject(db, { name: "Other", key: "OT" });
    await createTask(db, other.id, { title: "X" }, owner);
    expect(await dispatchNext(db, fakeGitHub().gw, other)).toBeNull();
  });

  it("rolls back and holds the task when GitHub refuses the dispatch", async () => {
    await createTask(db, project.id, { title: "A" }, owner);
    const { gw } = fakeGitHub(true);
    await dispatchNext(db, gw, project);
    const t = await getTaskByNumber(db, project.id, 1);
    expect(t).toMatchObject({ status: "todo", onHold: true });
    const [{ run }] = await listRuns(db, project.id);
    expect(run.status).toBe("failed");
    expect(await dispatchNext(db, gw, project)).toBeNull();
  });

  it("dispatchTask starts one task by hand, releasing its hold, even with auto-dispatch off", async () => {
    const t = await createTask(db, project.id, { title: "A" }, owner);
    await setTaskHold(db, t.id, true, owner);
    await settings({ autoDispatch: false });
    const run = await dispatchTask(db, fakeGitHub().gw, t.id, owner);
    expect(run.status).toBe("queued");
    expect(await getTaskByNumber(db, project.id, 1)).toMatchObject({ status: "in_progress", onHold: false });
    await setAgentsEnabled(db, false, owner);
    const t2 = await createTask(db, project.id, { title: "B" }, owner);
    await expect(dispatchTask(db, fakeGitHub().gw, t2.id, owner)).rejects.toThrow(/paused/);
  });

  it("the dispatched agent claims with its run id; a stopped run is refused", async () => {
    await createTask(db, project.id, { title: "A" }, owner);
    const run = await dispatchNext(db, fakeGitHub().gw, project);
    const { token } = await createApiToken(db, project.id, { name: "gha", scopes: ["tasks:read", "tasks:write"] }, owner);
    const auth = await authenticateToken(db, token);
    const ctx = agentContext(auth!.project, auth!.token);

    const claimed = await agentClaimTask(db, ctx, "AP-1", { runId: run!.id, githubRunId: 555 });
    expect(claimed.runId).toBe(run!.id);
    const [{ run: after }] = await listRuns(db, project.id);
    expect(after).toMatchObject({ status: "running", agent: "gha", githubRunId: 555 });

    const { gw, calls } = fakeGitHub();
    await stopRun(db, gw, run!.id, "blocked", owner);
    expect(calls).toEqual([{ name: "cancelWorkflowRun", args: [7, "octo", "planner", 555] }]);
    expect(await getTaskByNumber(db, project.id, 1)).toMatchObject({ status: "blocked", onHold: true });
    await expect(agentClaimTask(db, ctx, "AP-1", { runId: run!.id })).rejects.toThrow(/stopped by octocat/);
    await expect(stopRun(db, gw, run!.id, "todo", owner)).rejects.toThrow(/already/);
  });
});

describe("workflow_run webhooks", () => {
  const payload = (runId: string, action: string, conclusion: string | null = null) => ({
    action,
    repository: { name: "planner", owner: { login: "octo" } },
    workflow_run: {
      id: 9001,
      display_title: `AgentPlanner AP-1 run ${runId}`,
      html_url: "https://github.com/octo/planner/actions/runs/9001",
      status: action === "completed" ? "completed" : "in_progress",
      conclusion,
    },
  });

  it("links the GitHub run, and holds the task if the run ends without a review", async () => {
    await createTask(db, project.id, { title: "A" }, owner);
    const run = await dispatchNext(db, fakeGitHub().gw, project);
    await handleWorkflowRun(db, payload(run!.id, "in_progress"));
    expect((await listRuns(db, project.id))[0].run).toMatchObject({ githubRunId: 9001 });

    await handleWorkflowRun(db, payload(run!.id, "completed", "failure"));
    expect((await listRuns(db, project.id))[0].run.status).toBe("failed");
    expect(await getTaskByNumber(db, project.id, 1)).toMatchObject({ status: "todo", onHold: true });
    const last = (await getTimeline(db, (await getTaskByNumber(db, project.id, 1)).id)).at(-1);
    expect(last?.kind === "event" && last.event.type).toBe("run_ended_without_review");
  });

  it("leaves tasks the agent already submitted alone", async () => {
    await createTask(db, project.id, { title: "A" }, owner);
    const run = await dispatchNext(db, fakeGitHub().gw, project);
    const { token } = await createApiToken(db, project.id, { name: "gha", scopes: ["tasks:read", "tasks:write"] }, owner);
    const auth = await authenticateToken(db, token);
    const ctx = agentContext(auth!.project, auth!.token);
    await agentClaimTask(db, ctx, "AP-1", { runId: run!.id });
    await agentSubmitForReview(db, ctx, "AP-1", { summary: "done" });
    await handleWorkflowRun(db, payload(run!.id, "completed", "success"));
    expect(await getTaskByNumber(db, project.id, 1)).toMatchObject({ status: "in_review", onHold: false });
  });

  it("ignores runs that are not from AgentPlanner", async () => {
    expect(await handleWorkflowRun(db, { ...payload("x", "completed"), workflow_run: { ...payload("x", "completed").workflow_run, display_title: "CI" } })).toBe(
      "not an AgentPlanner run",
    );
  });
});

describe("review loop guard", () => {
  it(`holds the task after ${REVIEW_ROUNDS_LIMIT} agent change requests`, async () => {
    await createTask(db, project.id, { title: "A" }, owner);
    const { token } = await createApiToken(
      db,
      project.id,
      { name: "bot", scopes: ["tasks:read", "tasks:write", "reviews:write"] },
      owner,
    );
    const auth = await authenticateToken(db, token);
    const ctx = agentContext(auth!.project, auth!.token);
    for (let round = 1; round <= REVIEW_ROUNDS_LIMIT + 1; round++) {
      await agentClaimTask(db, ctx, "AP-1");
      await agentSubmitForReview(db, ctx, "AP-1", { summary: `try ${round}` });
      await agentRecordReview(db, ctx, "AP-1", { verdict: "request_changes", body: "no" });
    }
    expect(await getTaskByNumber(db, project.id, 1)).toMatchObject({ status: "in_review", onHold: true });
  });
});
