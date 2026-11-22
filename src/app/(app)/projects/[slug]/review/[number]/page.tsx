import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireOwner } from "@/auth";
import { CommitList, DiffView, type PlacedFinding } from "@/components/diff-view";
import { ArrowLeftIcon } from "@/components/icons";
import { PullRequestMeta, SEVERITY_CLASS, VerdictBadge } from "@/components/review-bits";
import { ReviewActions } from "@/components/review";
import { StatusBadge } from "@/components/task-list";
import { Badge, Card, EmptyState } from "@/components/ui";
import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github/gateway";
import { getTaskChanges } from "@/lib/services/github";
import { getProjectBySlug, type Project } from "@/lib/services/projects";
import { getTaskByNumber, listAgentComments, listReviewsForTasks, type Task } from "@/lib/services/tasks";
import { timeAgo } from "@/lib/ui/labels";
import { intParam, orNotFound } from "@/lib/ui/load";

/** Loads the pull request diff from GitHub; streams in after the rest of the page. */
async function Changes({ project, task, findings }: { project: Project; task: Task; findings: PlacedFinding[] }) {
  const changes = await getTaskChanges(getGitHub(), project, task);
  if (!changes.ok) {
    return (
      <EmptyState title="Changes are not available here.">
        {changes.reason}
        {task.prUrl && (
          <>
            {" "}
            <a href={`${task.prUrl}/files`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Open the pull request on GitHub
            </a>
            .
          </>
        )}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {changes.commits.length > 0 && <CommitList commits={changes.commits} />}
      {changes.files.length === 0 ? (
        <EmptyState title="This pull request has no file changes." />
      ) : (
        <DiffView files={changes.files} findings={findings} prUrl={task.prUrl} />
      )}
    </div>
  );
}

function ChangesSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-busy="true" aria-label="Loading changes">
      <div className="h-24 rounded-xl bg-surface-2" />
      <div className="h-72 rounded-xl bg-surface-2" />
    </div>
  );
}

/** Change browser: the agent's summary, the reviewer's findings, and the diff, with the decision alongside. */
export default async function ReviewTaskPage({ params }: PageProps<"/projects/[slug]/review/[number]">) {
  await requireOwner();
  await connection(); // Renders at request time: the page shows relative times ("5m ago").
  const { slug, number } = await params;
  const db = getDb();
  const project = await orNotFound(getProjectBySlug(db, slug));
  const task = await orNotFound(getTaskByNumber(db, project.id, intParam(number)));
  const [taskReviews, summaries] = await Promise.all([
    listReviewsForTasks(db, [task.id]),
    listAgentComments(db, [task.id]),
  ]);
  const latestReview = taskReviews[0];
  const summary = summaries[0];
  const findings: PlacedFinding[] = latestReview
    ? latestReview.findings.map((f) => ({ ...f, reviewer: latestReview.reviewer }))
    : [];
  const key = `${project.key}-${task.number}`;
  const queueHref = `/projects/${project.slug}/review`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href={queueHref} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeftIcon width={14} height={14} />
          Review queue
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted">{key}</span>
          <h2 className="text-xl font-semibold tracking-tight">{task.title}</h2>
          <StatusBadge status={task.status} />
        </div>
        <PullRequestMeta task={task} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {summary && (
            <Card className="flex flex-col gap-1.5 p-4">
              <p className="text-xs text-muted">
                <span className="font-medium text-fg">{summary.author}</span> summarised the work{" "}
                {timeAgo(summary.createdAt)}
              </p>
              <p className="text-sm whitespace-pre-wrap">{summary.body}</p>
            </Card>
          )}

          {latestReview && (
            <Card className="flex flex-col gap-2 p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{latestReview.reviewer}</span>
                <VerdictBadge verdict={latestReview.verdict} />
                <span className="text-xs text-muted">{timeAgo(latestReview.createdAt)}</span>
              </p>
              {latestReview.body && <p className="text-sm whitespace-pre-wrap">{latestReview.body}</p>}
              {latestReview.findings.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {latestReview.findings.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Badge className={`shrink-0 ${SEVERITY_CLASS[f.severity]}`}>{f.severity}</Badge>
                      <span className="min-w-0">
                        {f.file && (
                          <span className="font-mono text-xs break-all text-muted">
                            {f.file}
                            {f.line ? `:${f.line}` : ""}{" "}
                          </span>
                        )}
                        {f.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Suspense fallback={<ChangesSkeleton />}>
            <Changes project={project} task={task} findings={findings} />
          </Suspense>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-sm font-semibold">Your decision</h3>
            {task.status === "in_review" ? (
              <>
                <ReviewActions taskId={task.id} headSha={task.prHeadSha} doneHref={queueHref} />
                <p className="text-xs text-muted">
                  Approving merges exactly the commit shown here
                  {task.prHeadSha && <span className="font-mono"> ({task.prHeadSha.slice(0, 7)})</span>}. If the agent
                  pushes again first, the merge is refused.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                This task is not waiting for review, so there is nothing to decide. You can still browse its changes.
              </p>
            )}
          </Card>
          <Card className="flex flex-col gap-2 p-4 text-sm">
            <Link href={`/projects/${project.slug}/tasks/${task.number}`} className="text-accent hover:underline">
              Open task details
            </Link>
            {task.branchName && (
              <p className="text-xs text-muted">
                Branch <span className="font-mono break-all">{task.branchName}</span>
              </p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
