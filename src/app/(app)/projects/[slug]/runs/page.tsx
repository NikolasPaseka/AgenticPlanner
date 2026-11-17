import Link from "next/link";
import { requireOwner } from "@/auth";
import { RunStatusBadge } from "@/components/run-status";
import { StopRunButton } from "@/components/runs";
import { Card } from "@/components/ui";
import { getDb } from "@/lib/db";
import { listRuns } from "@/lib/services/dispatch";
import { getProjectBySlug } from "@/lib/services/projects";
import { timeAgo } from "@/lib/ui/labels";
import { orNotFound } from "@/lib/ui/load";

export default async function RunsPage({ params }: PageProps<"/projects/[slug]/runs">) {
  await requireOwner();
  const { slug } = await params;
  const db = getDb();
  const project = await orNotFound(getProjectBySlug(db, slug));
  const runs = await listRuns(db, project.id);
  const active = runs.filter((r) => r.run.status === "queued" || r.run.status === "running").length;

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
        <h1 className="text-xl font-semibold">Agent runs</h1>
        <p className="text-sm text-muted">
          {active} of {project.settings.maxParallelRuns} agent slots in use. Auto-dispatch is{" "}
          {project.settings.autoDispatch ? "on" : "off"} for this project.
        </p>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
          No agent runs yet.
        </div>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {runs.map(({ run, task }) => (
              <li key={run.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-sm">
                    {task ? (
                      <Link href={`/projects/${project.slug}/tasks/${task.number}`} className="hover:underline">
                        <span className="font-mono text-xs text-muted">
                          {project.key}-{task.number}
                        </span>{" "}
                        {task.title}
                      </Link>
                    ) : (
                      <span className="text-muted">No task</span>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {run.agent} ({run.role}) · started {timeAgo(run.startedAt ?? run.createdAt)}
                    {run.finishedAt && ` · finished ${timeAgo(run.finishedAt)}`}
                    {run.costUsd && ` · $${Number(run.costUsd).toFixed(2)}`}
                    {run.cancelledBy && ` · stopped by ${run.cancelledBy}`}
                    {run.githubRunUrl && (
                      <>
                        {" · "}
                        <a href={run.githubRunUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                          GitHub run
                        </a>
                      </>
                    )}
                  </p>
                  {run.summary && <p className="line-clamp-2 text-xs">{run.summary}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <RunStatusBadge status={run.status} />
                  {(run.status === "queued" || run.status === "running") && <StopRunButton runId={run.id} />}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
