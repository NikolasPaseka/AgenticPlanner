import type { TaskStatus } from "@/lib/domain/tasks";

/**
 * Project tabs. Task tabs show the tasks in these statuses; the tab's path is
 * relative to /projects/[slug] ("" is the project's start page).
 */
export const TASK_TABS = [
  { id: "planned", path: "", label: "Planned", statuses: ["proposed", "todo", "backlog"] },
  { id: "in-progress", path: "in-progress", label: "In progress", statuses: ["in_progress", "changes_requested", "blocked"] },
  { id: "review", path: "review", label: "Review", statuses: ["in_review"] },
  { id: "done", path: "done", label: "Done", statuses: ["merged", "done", "cancelled"] },
] as const satisfies readonly { id: string; path: string; label: string; statuses: readonly TaskStatus[] }[];

export type TaskTabId = (typeof TASK_TABS)[number]["id"];

export const taskTab = (id: TaskTabId) => TASK_TABS.find((t) => t.id === id)!;

/** The tab a task in this status belongs to. */
export function tabForStatus(status: TaskStatus) {
  return TASK_TABS.find((t) => (t.statuses as readonly TaskStatus[]).includes(status))!;
}

export function tabCount(counts: Partial<Record<TaskStatus, number>>, id: TaskTabId): number {
  return taskTab(id).statuses.reduce((n, s) => n + (counts[s] ?? 0), 0);
}
