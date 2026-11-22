import type { Review } from "@/lib/services/tasks";
import type { Task } from "@/lib/services/tasks";
import { ExternalIcon, PullRequestIcon } from "./icons";
import { Badge, cn } from "./ui";

const CHECKS: Record<string, { label: string; className: string }> = {
  success: { label: "Checks passed", className: "text-emerald-700 dark:text-emerald-300" },
  failure: { label: "Checks failing", className: "text-red-600 dark:text-red-400" },
  pending: { label: "Checks running", className: "text-amber-700 dark:text-amber-300" },
};

/** PR link, head commit, checks, and preview link for a task in review. */
export function PullRequestMeta({ task }: { task: Task }) {
  const checks = task.checksStatus ? CHECKS[task.checksStatus] : null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {task.prUrl ? (
        <a
          href={task.prUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-accent hover:underline"
        >
          <PullRequestIcon />
          PR #{task.prNumber}
          {task.prHeadSha && <span className="font-mono text-xs text-muted">{task.prHeadSha.slice(0, 7)}</span>}
        </a>
      ) : (
        <Badge className="text-muted">No PR linked</Badge>
      )}
      {checks && <Badge className={checks.className}>{checks.label}</Badge>}
      {task.previewUrl && (
        <a
          href={task.previewUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          Preview
          <ExternalIcon width={12} height={12} />
        </a>
      )}
    </div>
  );
}

export const VERDICT = {
  approve: { label: "Recommends approval", className: "text-emerald-700 dark:text-emerald-300" },
  request_changes: { label: "Changes requested", className: "text-orange-700 dark:text-orange-300" },
  comment: { label: "Comment", className: "text-muted" },
} as const;

export const SEVERITY_CLASS = {
  critical: "text-red-600 dark:text-red-400",
  major: "text-red-600 dark:text-red-400",
  minor: "text-amber-700 dark:text-amber-300",
  nit: "text-muted",
} as const;

export function VerdictBadge({ verdict }: { verdict: Review["verdict"] }) {
  return <Badge className={cn(VERDICT[verdict].className)}>{VERDICT[verdict].label}</Badge>;
}
