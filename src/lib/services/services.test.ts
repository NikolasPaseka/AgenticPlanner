import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { InvalidTransitionError } from "@/lib/domain/tasks";
import { createTestDb } from "@/test/db";
import type { Actor } from "./actor";
import { ConflictError } from "./errors";
import { createProject, listProjectsWithCounts } from "./projects";
import { getAppSettings, setAgentsEnabled } from "./settings";
import {
  addComment,
  createTask,
  getTimeline,
  listTasks,
  setTaskHold,
  transitionTask,
  updateTask,
} from "./tasks";

const owner: Actor = { kind: "owner", name: "octocat" };
const agent: Actor = { kind: "agent", name: "developer" };

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

async function project() {
  return createProject(db, { name: "Agent Planner", key: "ap" });
}

describe("projects", () => {
  it("creates projects with slug and upper-case key", async () => {
    const p = await project();
    expect(p.slug).toBe("agent-planner");
    expect(p.key).toBe("AP");
    expect(p.settings).toMatchObject({ mergeMethod: "merge", autoDispatch: true, maxParallelRuns: 1 });
  });

  it("rejects duplicate keys and de-duplicates slugs", async () => {
    await project();
    await expect(createProject(db, { name: "Other", key: "AP" })).rejects.toBeInstanceOf(ConflictError);
    const second = await createProject(db, { name: "Agent Planner", key: "AP2" });
    expect(second.slug).toBe("agent-planner-2");
  });

  it("counts tasks per status", async () => {
    const p = await project();
    await createTask(db, p.id, { title: "One" } as never, owner);
    await createTask(db, p.id, { title: "Two" } as never, agent);
    const [row] = await listProjectsWithCounts(db);
    expect(row.counts).toEqual({ todo: 1, proposed: 1 });
  });
});

describe("tasks", () => {
  it("numbers tasks per project and logs creation", async () => {
    const p = await project();
    const a = await createTask(db, p.id, { title: "First", labels: "UI, ui , api" } as never, owner);
    const b = await createTask(db, p.id, { title: "Second" } as never, owner);
    expect([a.number, b.number]).toEqual([1, 2]);
    expect(a.labels).toEqual(["ui", "api"]);
    expect(a.status).toBe("todo");
    const timeline = await getTimeline(db, a.id);
    expect(timeline).toHaveLength(1);
  });

  it("makes agent-created tasks proposals", async () => {
    const p = await project();
    const t = await createTask(db, p.id, { title: "Found a bug", status: "todo" } as never, agent);
    expect(t.status).toBe("proposed");
    expect(t.source).toBe("agent");
    await expect(transitionTask(db, t.id, "todo", agent)).rejects.toBeInstanceOf(InvalidTransitionError);
    expect((await transitionTask(db, t.id, "todo", owner)).status).toBe("todo");
  });

  it("transitions with an audit event and blocks agent merges", async () => {
    const p = await project();
    const t = await createTask(db, p.id, { title: "Work" } as never, owner);
    await transitionTask(db, t.id, "in_progress", agent);
    await transitionTask(db, t.id, "in_review", agent);
    await expect(transitionTask(db, t.id, "merged", agent)).rejects.toBeInstanceOf(InvalidTransitionError);
    const events = (await getTimeline(db, t.id)).filter((i) => i.kind === "event");
    expect(events.map((e) => (e.kind === "event" ? e.event.to : null))).toEqual([
      "todo",
      "in_progress",
      "in_review",
    ]);
  });

  it("stops agents from claiming held tasks", async () => {
    const p = await project();
    const t = await createTask(db, p.id, { title: "Careful" } as never, owner);
    await setTaskHold(db, t.id, true, owner);
    await expect(transitionTask(db, t.id, "in_progress", agent)).rejects.toBeInstanceOf(ConflictError);
    await expect(setTaskHold(db, t.id, false, agent)).rejects.toThrow();
    await setTaskHold(db, t.id, false, owner);
    expect((await transitionTask(db, t.id, "in_progress", agent)).status).toBe("in_progress");
  });

  it("records only changed fields on update", async () => {
    const p = await project();
    const t = await createTask(db, p.id, { title: "Old" } as never, owner);
    const updated = await updateTask(db, t.id, { title: "New", priority: "medium" }, owner);
    expect(updated.title).toBe("New");
    const last = (await getTimeline(db, t.id)).at(-1);
    expect(last?.kind === "event" && last.event.payload).toEqual({ fields: ["title"] });
    const again = await updateTask(db, t.id, { priority: "high" }, owner);
    expect(again).toMatchObject({ title: "New", priority: "high", type: "feature" });
  });

  it("filters by search, key, priority, and closed status", async () => {
    const p = await project();
    await createTask(db, p.id, { title: "Login page", priority: "high" } as never, owner);
    const t2 = await createTask(db, p.id, { title: "Board view" } as never, owner);
    expect((await listTasks(db, p, { q: "login" })).map((t) => t.number)).toEqual([1]);
    expect((await listTasks(db, p, { q: "ap-2" })).map((t) => t.number)).toEqual([2]);
    expect((await listTasks(db, p, { priority: "high" })).map((t) => t.number)).toEqual([1]);
    await transitionTask(db, t2.id, "cancelled", owner);
    expect(await listTasks(db, p)).toHaveLength(1);
    expect(await listTasks(db, p, { includeClosed: true })).toHaveLength(2);
  });

  it("adds comments to the timeline", async () => {
    const p = await project();
    const t = await createTask(db, p.id, { title: "Discuss" } as never, owner);
    await addComment(db, t.id, { body: "Looks good" }, agent);
    const items = await getTimeline(db, t.id);
    expect(items.at(-1)?.kind).toBe("comment");
  });
});

describe("global agents switch", () => {
  it("defaults to on and records who paused", async () => {
    expect((await getAppSettings(db)).agentsEnabled).toBe(true);
    const off = await setAgentsEnabled(db, false, owner);
    expect(off).toMatchObject({ agentsEnabled: false, agentsPausedBy: "octocat" });
    await expect(setAgentsEnabled(db, true, agent)).rejects.toThrow();
    expect((await setAgentsEnabled(db, true, owner)).agentsPausedBy).toBeNull();
  });
});
