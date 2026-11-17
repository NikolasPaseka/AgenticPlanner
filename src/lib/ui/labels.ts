import type { TaskStatus } from "@/lib/domain/tasks";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  proposed: "Proposed by agents",
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  blocked: "Blocked",
  in_review: "In review",
  changes_requested: "Changes requested",
  merged: "Merged",
  done: "Done",
  cancelled: "Cancelled",
};

/** Section order on the task list: what needs your attention first. */
export const STATUS_GROUP_ORDER: TaskStatus[] = [
  "proposed",
  "in_review",
  "blocked",
  "changes_requested",
  "in_progress",
  "todo",
  "backlog",
  "merged",
  "done",
  "cancelled",
];

export const STATUS_DOT: Record<TaskStatus, string> = {
  proposed: "bg-violet-500",
  backlog: "bg-zinc-400",
  todo: "bg-sky-500",
  in_progress: "bg-amber-500",
  blocked: "bg-red-500",
  in_review: "bg-indigo-500",
  changes_requested: "bg-orange-500",
  merged: "bg-emerald-500",
  done: "bg-emerald-600",
  cancelled: "bg-zinc-500",
};

/** Verb shown on the button that moves a task to this status. */
export const TRANSITION_LABEL: Partial<Record<TaskStatus, string>> = {
  todo: "Move to Todo",
  backlog: "Move to Backlog",
  in_progress: "Start work",
  blocked: "Mark blocked",
  in_review: "Submit for review",
  changes_requested: "Request changes",
  done: "Mark done",
  cancelled: "Cancel task",
};

export const PRIORITY_LABEL = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" } as const;
export const PRIORITY_CLASS = {
  urgent: "text-red-600 dark:text-red-400",
  high: "text-orange-600 dark:text-orange-400",
  medium: "text-muted",
  low: "text-muted",
} as const;

export const TYPE_LABEL = {
  feature: "Feature",
  bug: "Bug",
  chore: "Chore",
  refactor: "Refactor",
  docs: "Docs",
  test: "Test",
  security: "Security",
} as const;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function timeAgo(date: Date, now = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, s] of units) {
    if (Math.abs(seconds) >= s) return rtf.format(Math.round(seconds / s), unit);
  }
  return "just now";
}
