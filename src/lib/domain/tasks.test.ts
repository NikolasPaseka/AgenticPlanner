import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  assertTransition,
  branchNameFor,
  canTransition,
  compareForDispatch,
  InvalidTransitionError,
  isClaimable,
  pickNextTask,
  projectDispatchBlocker,
} from "./tasks";

describe("task state machine", () => {
  it("lets agents claim and submit work", () => {
    expect(canTransition("todo", "in_progress", "agent")).toBe(true);
    expect(canTransition("in_progress", "in_review", "agent")).toBe(true);
  });

  it("never lets an agent merge or accept its own proposal", () => {
    expect(canTransition("in_review", "merged", "agent")).toBe(false);
    expect(canTransition("proposed", "todo", "agent")).toBe(false);
  });

  it("only the owner merges", () => {
    expect(canTransition("in_review", "merged", "owner")).toBe(true);
    expect(canTransition("in_review", "merged", "system")).toBe(false);
  });

  it("marks merged tasks done after deploy", () => {
    expect(canTransition("merged", "done", "system")).toBe(true);
  });

  it("throws on invalid transitions", () => {
    expect(() => assertTransition("done", "in_review", "agent")).toThrow(InvalidTransitionError);
  });

  it("lists allowed transitions per actor", () => {
    expect(allowedTransitions("proposed", "agent")).toEqual([]);
    expect(allowedTransitions("changes_requested", "agent")).toEqual(["in_progress"]);
  });
});

describe("dispatch order", () => {
  it("sorts by priority, then age", () => {
    const old = new Date("2026-01-01");
    const recent = new Date("2026-06-01");
    const tasks = [
      { id: "a", priority: "low" as const, createdAt: old },
      { id: "b", priority: "urgent" as const, createdAt: recent },
      { id: "c", priority: "high" as const, createdAt: recent },
      { id: "d", priority: "high" as const, createdAt: old },
    ];
    expect(tasks.sort(compareForDispatch).map((t) => t.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("branchNameFor", () => {
  it("builds agent branch names", () => {
    expect(branchNameFor("AP", 42, "Add Kanban board & filters!")).toBe(
      "agent/AP-42-add-kanban-board-filters",
    );
  });
});

describe("owner controls", () => {
  const ctx = {
    agentsEnabled: true,
    project: { autoDispatch: true, maxParallelRuns: 1, activeRuns: 0 },
  };
  const t = (id: string, priority: "urgent" | "low", onHold = false, status: "todo" | "done" = "todo") => ({
    id,
    priority,
    onHold,
    status,
    createdAt: new Date("2026-01-01"),
  });

  it("dispatches nothing when the global switch is off", () => {
    expect(pickNextTask({ ...ctx, agentsEnabled: false }, [t("a", "urgent")])).toBeNull();
    expect(projectDispatchBlocker({ ...ctx, agentsEnabled: false })).toBe("agents_disabled");
  });

  it("dispatches nothing when project auto-dispatch is off or at the limit", () => {
    expect(pickNextTask({ ...ctx, project: { ...ctx.project, autoDispatch: false } }, [t("a", "low")])).toBeNull();
    expect(pickNextTask({ ...ctx, project: { ...ctx.project, activeRuns: 1 } }, [t("a", "low")])).toBeNull();
  });

  it("skips tasks on hold and picks the next one", () => {
    expect(pickNextTask(ctx, [t("held", "urgent", true), t("b", "low"), t("c", "low", false, "done")])?.id).toBe("b");
  });

  it("refuses to claim held tasks", () => {
    expect(isClaimable({ status: "todo", onHold: true })).toBe(false);
    expect(isClaimable({ status: "changes_requested", onHold: false })).toBe(true);
  });

  it("lets the owner stop a run back to todo or blocked", () => {
    expect(canTransition("in_progress", "todo", "owner")).toBe(true);
    expect(canTransition("in_progress", "blocked", "owner")).toBe(true);
  });
});
