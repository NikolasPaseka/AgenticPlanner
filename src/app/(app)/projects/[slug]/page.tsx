import Link from "next/link";
import { requireOwner } from "@/auth";
import { NewTaskForm, TaskFilters } from "@/components/forms";
import { TaskGroups, type GroupBy } from "@/components/task-list";
import { buttonClass, Card } from "@/components/ui";
import { getDb } from "@/lib/db";
import { getProjectBySlug } from "@/lib/services/projects";
import { listTasks } from "@/lib/services/tasks";
import { countReviewQueue } from "@/lib/services/github";
import { orNotFound } from "@/lib/ui/load";
import { PRIORITIES, TASK_TYPES } from "@/lib/validation";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[slug]">) {
  await requireOwner();
  const { slug } = await params;
  const sp = await searchParams;
  const db = getDb();
  const project = await orNotFound(getProjectBySlug(db, slug));

  const group = (["status", "priority", "type"] as const).find((g) => g === one(sp.group)) ?? "status";
  const priority = (PRIORITIES as readonly string[]).includes(one(sp.priority)) ? one(sp.priority) : "";
  const type = (TASK_TYPES as readonly string[]).includes(one(sp.type)) ? one(sp.type) : "";
  const q = one(sp.q).slice(0, 200);
  const closed = one(sp.closed) === "1";

  const [tasks, reviewCount] = await Promise.all([
    listTasks(db, project, { q, priority, type, includeClosed: closed }),
    countReviewQueue(db, project.id),
  ]);
  const repo = project.githubOwner && project.githubRepo ? `${project.githubOwner}/${project.githubRepo}` : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            <Link href="/" className="hover:underline">
              Projects
            </Link>
          </p>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
            {repo && (
              <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer" className="hover:underline">
                {repo}
              </a>
            )}
            {project.productionUrl && (
              <a href={project.productionUrl} target="_blank" rel="noreferrer" className="hover:underline">
                {new URL(project.productionUrl).host}
              </a>
            )}
            {!project.settings.autoDispatch && <span>Auto-dispatch off</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/projects/${project.slug}/review`}
            className={buttonClass(reviewCount > 0 ? "primary" : "secondary")}
          >
            Review{reviewCount > 0 && ` (${reviewCount})`}
          </Link>
          <Link href={`/projects/${project.slug}/settings`} className={buttonClass("secondary")}>
            Settings
          </Link>
        </div>
      </div>

      <Card className="p-4">
        <details>
          <summary className="cursor-pointer text-sm font-semibold">+ New task</summary>
          <div className="pt-4">
            <NewTaskForm projectId={project.id} />
          </div>
        </details>
      </Card>

      <TaskFilters action={`/projects/${project.slug}`} values={{ q, priority, type, group, closed }} />

      <TaskGroups tasks={tasks} groupBy={group as GroupBy} projectKey={project.key} slug={project.slug} />
    </div>
  );
}
