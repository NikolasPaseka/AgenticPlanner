import { desc, inArray } from "drizzle-orm";
import Link from "next/link";
import { requireOwner } from "@/auth";
import { ReviewActions } from "@/components/review";
import { Badge, Card, cn } from "@/components/ui";
import { getDb } from "@/lib/db";
import { comments, reviews } from "@/lib/db/schema";
import { listReviewQueue } from "@/lib/services/github";
import { getProjectBySlug } from "@/lib/services/projects";
import { PRIORITY_CLASS, PRIORITY_LABEL, timeAgo } from "@/lib/ui/labels";
import { orNotFound } from "@/lib/ui/load";

const CHECKS: Record<string, { label: string; className: string }> = {
  success: { label: "Checks passed", className: "text-emerald-700 dark:text-emerald-300" },
  failure: { label: "Checks failing", className: "text-red-600 dark:text-red-400" },
  pending: { label: "Checks running", className: "text-amber-700 dark:text-amber-300" },
};

export default async function ReviewPage({ params }: PageProps<"/projects/[slug]/review">) {
  await requireOwner();
  const { slug } = await params;
  const db = getDb();
  const project = await orNotFound(getProjectBySlug(db, slug));
  const queue = await listReviewQueue(db, project.id);
  const ids = queue.map((t) => t.id);
  const [taskReviews, notes] = ids.length
    ? await Promise.all([
        db.select().from(reviews).where(inArray(reviews.taskId, ids)).orderBy(desc(reviews.createdAt)),
        db
          .select()
          .from(comments)
          .where(inArray(comments.taskId, ids))
          .orderBy(desc(comments.createdAt)),
      ])
    : [[], []];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted">
          <Link href="/" className="hover:underline">
            Projects
          </Link>{" "}
          /{" "}
          <Link href={`/projects/${project.slug}`} className="hover:underline">
            {project.name}
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Review queue</h1>
        <p className="text-sm text-muted">
          Approving merges the pull request into {project.defaultBranch} with a{" "}
          {project.settings.mergeMethod === "merge" ? "merge commit" : project.settings.mergeMethod}; Vercel then
          deploys it.
        </p>
      </div>

      {queue.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
          Nothing to review right now.
        </div>
      )}

      {queue.map((task) => {
        const key = `${project.key}-${task.number}`;
        const review = taskReviews.find((r) => r.taskId === task.id);
        const summary = notes.find((c) => c.taskId === task.id && c.authorType === "agent");
        const checks = task.checksStatus ? CHECKS[task.checksStatus] : null;
        return (
          <Card key={task.id} className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/projects/${project.slug}/tasks/${task.number}`} className="hover:underline">
                  <span className="font-mono text-xs text-muted">{key}</span>{" "}
                  <span className="font-semibold">{task.title}</span>
                </Link>
                <p className={cn("text-xs", PRIORITY_CLASS[task.priority])}>{PRIORITY_LABEL[task.priority]} priority</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {task.prUrl ? (
                  <a href={task.prUrl} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
                    PR #{task.prNumber}
                    {task.prHeadSha && <span className="ml-1 font-mono text-xs text-muted">{task.prHeadSha.slice(0, 7)}</span>}
                  </a>
                ) : (
                  <Badge className="text-muted">No PR linked</Badge>
                )}
                {checks && <Badge className={checks.className}>{checks.label}</Badge>}
                {task.previewUrl && (
                  <a href={task.previewUrl} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
                    Preview
                  </a>
                )}
              </div>
            </div>

            {summary && (
              <div className="text-sm">
                <p className="mb-1 text-xs text-muted">
                  {summary.author} wrote {timeAgo(summary.createdAt)}
                </p>
                <p className="line-clamp-6 whitespace-pre-wrap">{summary.body}</p>
              </div>
            )}

            {review && (
              <div className="rounded-md border border-border p-3 text-sm">
                <p className="mb-1">
                  <span className="font-medium">{review.reviewer}</span>{" "}
                  {review.verdict === "approve"
                    ? "recommends approval"
                    : review.verdict === "request_changes"
                      ? "requested changes"
                      : "commented"}
                  {review.findings.length > 0 && `, ${review.findings.length} findings`}
                </p>
                {review.body && <p className="line-clamp-4 whitespace-pre-wrap text-muted">{review.body}</p>}
              </div>
            )}

            <ReviewActions taskId={task.id} headSha={task.prHeadSha} />
          </Card>
        );
      })}
    </div>
  );
}
