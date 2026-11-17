import Link from "next/link";
import { requireOwner } from "@/auth";
import { setTaskHoldAction, transitionTaskAction } from "@/app/actions";
import { CommentForm, EditTaskForm } from "@/components/forms";
import { RunAgentNowButton, StopRunButton } from "@/components/runs";
import { RunStatusBadge } from "@/components/run-status";
import { githubConfigured } from "@/lib/github/config";
import { StatusBadge } from "@/components/task-list";
import { Badge, Button, buttonClass, Card, cn } from "@/components/ui";
import { getDb } from "@/lib/db";
import { allowedTransitions, type TaskStatus } from "@/lib/domain/tasks";
import { desc, eq } from "drizzle-orm";
import { reviews as reviewsTable } from "@/lib/db/schema";
import { listRunsForTask } from "@/lib/services/agents";
import { getProjectBySlug } from "@/lib/services/projects";
import { getTaskByNumber, getTimeline, type TaskEvent, type TimelineItem } from "@/lib/services/tasks";
import {
  PRIORITY_CLASS,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TRANSITION_LABEL,
  TYPE_LABEL,
  timeAgo,
} from "@/lib/ui/labels";
import { intParam, orNotFound } from "@/lib/ui/load";

function describeEvent(e: TaskEvent): string {
  switch (e.type) {
    case "created":
      return `created this task in ${STATUS_LABEL[e.to as TaskStatus] ?? e.to}`;
    case "status_changed":
      return `moved it from ${STATUS_LABEL[e.from as TaskStatus] ?? e.from} to ${STATUS_LABEL[e.to as TaskStatus] ?? e.to}`;
    case "updated": {
      const fields = (e.payload.fields as string[] | undefined) ?? [];
      return `edited ${fields.map((f) => f.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)).join(", ")}`;
    }
    case "hold_set":
      return "put it on hold";
    case "hold_released":
      return "released the hold";
    case "pr_linked":
      return `linked pull request #${String(e.payload.prNumber ?? "")}`;
    case "pr_updated":
      return `pushed new commits (${String(e.payload.sha ?? "")})`;
    case "pr_closed":
      return `closed pull request #${String(e.payload.prNumber ?? "")}`;
    case "pr_merged_outside":
      return `merged pull request #${String(e.payload.prNumber ?? "")} outside the review flow`;
    case "checks_updated":
      return `reported checks ${String(e.payload.status ?? "")}`;
    case "preview_ready":
      return "deployed a preview";
    case "preview_failed":
      return "failed to deploy a preview";
    case "review_loop_stopped":
      return `stopped the review loop after ${String(e.payload.rounds ?? "several")} rounds; the task is on hold for you`;
    case "run_dispatched":
      return "started an agent run";
    case "dispatch_failed":
      return `could not start an agent run (${String(e.payload.message ?? "")}); the task is on hold`;
    case "run_stopped":
      return "stopped the agent run and put the task on hold";
    case "run_ended_without_review": {
      const how = String(e.payload.conclusion ?? "ended");
      return `saw the agent run end (${how}) without a review; the task is on hold`;
    }
    case "branch_linked":
      return `linked branch ${String(e.payload.branch ?? "")}`;
    case "review_recorded": {
      const verdict = String(e.payload.verdict ?? "comment").replace("_", " ");
      return `recorded a review (${verdict}, ${String(e.payload.findings ?? 0)} findings)`;
    }
    default:
      return e.type.replace(/_/g, " ");
  }
}

function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) =>
        item.kind === "event" ? (
          <li key={item.event.id} className="flex gap-2 text-sm text-muted">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-border" />
            <p>
              <span className="font-medium text-fg">{item.event.actor}</span> {describeEvent(item.event)}{" "}
              <time dateTime={item.at.toISOString()} title={item.at.toISOString()}>
                {timeAgo(item.at)}
              </time>
            </p>
          </li>
        ) : (
          <li key={item.comment.id}>
            <Card className="p-3">
              <p className="mb-1 text-xs text-muted">
                <span className="font-medium text-fg">{item.comment.author}</span>
                {item.comment.authorType === "agent" && " (agent)"} commented {timeAgo(item.at)}
              </p>
              <p className="text-sm whitespace-pre-wrap">{item.comment.body}</p>
            </Card>
          </li>
        ),
      )}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function TaskPage({ params }: PageProps<"/projects/[slug]/tasks/[number]">) {
  await requireOwner();
  const { slug, number } = await params;
  const db = getDb();
  const project = await orNotFound(getProjectBySlug(db, slug));
  const task = await orNotFound(getTaskByNumber(db, project.id, intParam(number)));
  const [timeline, runs, taskReviews] = await Promise.all([
    getTimeline(db, task.id),
    listRunsForTask(db, task.id),
    db.select().from(reviewsTable).where(eq(reviewsTable.taskId, task.id)).orderBy(desc(reviewsTable.createdAt)),
  ]);
  // Merging happens through the review flow once a PR exists (M3), never by a plain button.
  // In review, decisions go through the review queue so the PR is merged, commented, or closed too.
  const transitions =
    task.status === "in_review" ? [] : allowedTransitions(task.status, "owner").filter((s) => s !== "merged");
  const key = `${project.key}-${task.number}`;
  const canRunNow =
    githubConfigured() &&
    !!project.githubInstallationId &&
    (task.status === "todo" || task.status === "changes_requested");

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
          </Link>{" "}
          / <span className="font-mono">{key}</span>
        </p>
        <h1 className="mt-1 text-xl font-semibold">{task.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={task.status} />
          <Badge className={PRIORITY_CLASS[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
          <Badge className="text-muted">{TYPE_LABEL[task.type]}</Badge>
          {task.onHold && <Badge className="text-amber-700 dark:text-amber-300">On hold</Badge>}
          {task.labels.map((l) => (
            <Badge key={l} className="text-muted">
              {l}
            </Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_17rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Description">
            <Card className="p-4">
              <p className={cn("text-sm whitespace-pre-wrap", !task.description && "text-muted")}>
                {task.description || "No description."}
              </p>
            </Card>
          </Section>

          <Section title="Acceptance criteria">
            <Card className="p-4">
              <p className={cn("text-sm whitespace-pre-wrap", !task.acceptanceCriteria && "text-muted")}>
                {task.acceptanceCriteria || "None yet. Agents work best with clear criteria."}
              </p>
            </Card>
          </Section>

          <Card className="p-4">
            <details>
              <summary className="cursor-pointer text-sm font-semibold">Edit task</summary>
              <div className="pt-4">
                <EditTaskForm task={task} />
              </div>
            </details>
          </Card>

          {taskReviews.length > 0 && (
            <Section title="Reviews">
              <div className="flex flex-col gap-3">
                {taskReviews.map((r) => (
                  <Card key={r.id} className="flex flex-col gap-2 p-4">
                    <p className="text-sm">
                      <span className="font-medium">{r.reviewer}</span>{" "}
                      <Badge
                        className={
                          r.verdict === "request_changes"
                            ? "text-orange-700 dark:text-orange-300"
                            : r.verdict === "approve"
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-muted"
                        }
                      >
                        {r.verdict === "request_changes" ? "Changes requested" : r.verdict === "approve" ? "Recommends approval" : "Comment"}
                      </Badge>{" "}
                      <span className="text-xs text-muted">{timeAgo(r.createdAt)}</span>
                    </p>
                    {r.body && <p className="text-sm whitespace-pre-wrap">{r.body}</p>}
                    {r.findings.length > 0 && (
                      <ul className="flex flex-col gap-1 text-sm">
                        {r.findings.map((f, i) => (
                          <li key={i} className="flex gap-2">
                            <Badge className={f.severity === "critical" || f.severity === "major" ? "text-red-600 dark:text-red-400" : "text-muted"}>
                              {f.severity}
                            </Badge>
                            <span>
                              {f.file && (
                                <span className="font-mono text-xs text-muted">
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
                ))}
              </div>
            </Section>
          )}

          <Section title="Activity">
            <Timeline items={timeline} />
            <CommentForm taskId={task.id} />
          </Section>
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-semibold">Status</h2>
            <StatusBadge status={task.status} />
            {task.status === "in_review" && (
              <Link href={`/projects/${project.slug}/review`} className={buttonClass("primary", "sm")}>
                Open in review queue
              </Link>
            )}
            {transitions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {transitions.map((to) => (
                  <form key={to} action={transitionTaskAction}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="to" value={to} />
                    <Button
                      type="submit"
                      size="sm"
                      variant={to === "cancelled" ? "danger" : "secondary"}
                      className="w-full justify-start"
                    >
                      {task.status === "proposed" && to === "todo" ? "Accept proposal" : TRANSITION_LABEL[to]}
                    </Button>
                  </form>
                ))}
              </div>
            )}
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="text-sm font-semibold">Agents</h2>
            <p className="text-xs text-muted">
              {task.onHold
                ? "On hold: agents will not pick up this task."
                : "Agents can pick up this task when it is in Todo."}
            </p>
            <form action={setTaskHoldAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="onHold" value={String(!task.onHold)} />
              <Button type="submit" size="sm" className="w-full">
                {task.onHold ? "Release hold" : "Put on hold"}
              </Button>
            </form>
            {canRunNow && <RunAgentNowButton taskId={task.id} />}
          </Card>

          {runs.length > 0 && (
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="text-sm font-semibold">Agent runs</h2>
              <ul className="flex flex-col gap-2.5 text-sm">
                {runs.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {r.githubRunUrl ? (
                          <a href={r.githubRunUrl} target="_blank" rel="noreferrer" className="hover:underline">
                            {r.agent}
                          </a>
                        ) : (
                          r.agent
                        )}{" "}
                        <span className="text-xs text-muted">({r.role})</span>
                      </span>
                      <RunStatusBadge status={r.status} />
                    </div>
                    {(r.status === "running" || r.status === "queued") && <StopRunButton runId={r.id} />}
                    {r.cancelledBy && <span className="text-xs text-muted">Stopped by {r.cancelledBy}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-4">
            <dl className="flex flex-col gap-2">
              <Meta label="Key">
                <span className="font-mono">{key}</span>
              </Meta>
              <Meta label="Created by">
                {task.source === "agent" ? `${task.createdByAgent ?? "agent"} (agent)` : "You"}
              </Meta>
              {task.assignee && <Meta label="Assignee">{task.assignee}</Meta>}
              <Meta label="Created">{timeAgo(task.createdAt)}</Meta>
              <Meta label="Updated">{timeAgo(task.updatedAt)}</Meta>
              {task.branchName && (
                <Meta label="Branch">
                  <span className="font-mono text-xs break-all">{task.branchName}</span>
                </Meta>
              )}
              {task.prUrl && (
                <Meta label="Pull request">
                  <a href={task.prUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    #{task.prNumber}
                  </a>
                </Meta>
              )}
              {task.productionDeployedAt && <Meta label="In production">{timeAgo(task.productionDeployedAt)}</Meta>}
              {task.previewUrl && (
                <Meta label="Preview">
                  <a href={task.previewUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    Open
                  </a>
                </Meta>
              )}
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}
