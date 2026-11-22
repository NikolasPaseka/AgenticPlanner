import { cacheLife } from "next/cache";
import Link from "next/link";
import { requireOwner } from "@/auth";
import { ChevronIcon } from "@/components/icons";
import { PullRequestMeta, VerdictBadge } from "@/components/review-bits";
import { buttonClass, Card, cn, EmptyState } from "@/components/ui";
import { getDb } from "@/lib/db";
import { listReviewQueue } from "@/lib/services/github";
import { getProjectBySlug } from "@/lib/services/projects";
import { listAgentComments, listReviewsForTasks } from "@/lib/services/tasks";
import { PRIORITY_CLASS, PRIORITY_LABEL, timeAgo } from "@/lib/ui/labels";
import { orNotFound } from "@/lib/ui/load";

/** Fresh on every server request; the browser may reuse a prefetched copy for 30 seconds (see TaskTab). */
async function loadQueue(slug: string) {
  "use cache: private";
  cacheLife({ stale: 30 });
  const db = getDb();
  const project = await orNotFound(getProjectBySlug(db, slug));
  const queue = await listReviewQueue(db, project.id);
  const ids = queue.map((t) => t.id);
  const [taskReviews, summaries] = await Promise.all([listReviewsForTasks(db, ids), listAgentComments(db, ids)]);
  return { project, queue, taskReviews, summaries, now: new Date() };
}

/** Review tab: pull requests waiting for the owner, oldest first. */
export default async function ReviewQueuePage({ params }: PageProps<"/projects/[slug]/review">) {
  await requireOwner();
  const { slug } = await params;
  const { project, queue, taskReviews, summaries, now } = await loadQueue(slug);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Open a task to read the agent&apos;s changes. Approving merges the pull request into {project.defaultBranch}{" "}
        with a {project.settings.mergeMethod === "merge" ? "merge commit" : project.settings.mergeMethod}, and Vercel
        then deploys it.
      </p>

      {queue.length === 0 && (
        <EmptyState title="Nothing to review right now.">
          Tasks appear here when an agent opens a pull request and submits it for review.
        </EmptyState>
      )}

      <ul className="flex flex-col gap-3">
        {queue.map((task) => {
          const key = `${project.key}-${task.number}`;
          const review = taskReviews.find((r) => r.taskId === task.id);
          const summary = summaries.find((c) => c.taskId === task.id);
          const href = `/projects/${project.slug}/review/${task.number}`;
          return (
            <li key={task.id}>
              <Card className="flex flex-col gap-3 p-4 transition hover:border-border-strong">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={href} className="group/title">
                      <span className="font-mono text-xs text-muted">{key}</span>{" "}
                      <span className="font-semibold group-hover/title:underline">{task.title}</span>
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className={cn(PRIORITY_CLASS[task.priority])}>{PRIORITY_LABEL[task.priority]} priority</span>
                      {" · "}submitted {timeAgo(task.updatedAt, now)}
                    </p>
                  </div>
                  <Link href={href} className={buttonClass("primary", "sm")}>
                    Review changes
                    <ChevronIcon width={14} height={14} />
                  </Link>
                </div>
                <PullRequestMeta task={task} />
                {summary && (
                  <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted">
                    <span className="font-medium text-fg">{summary.author}:</span> {summary.body}
                  </p>
                )}
                {review && (
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{review.reviewer}</span>
                    <VerdictBadge verdict={review.verdict} />
                    {review.findings.length > 0 && (
                      <span className="text-muted">
                        {review.findings.length} finding{review.findings.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
