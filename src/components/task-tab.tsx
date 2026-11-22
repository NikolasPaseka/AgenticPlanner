import { cacheLife } from "next/cache";
import { requireOwner } from "@/auth";
import { getDb } from "@/lib/db";
import { getProjectBySlug } from "@/lib/services/projects";
import { listTasks, type TaskFilters as Filters } from "@/lib/services/tasks";
import { taskTab, type TaskTabId } from "@/lib/ui/tabs";
import { orNotFound } from "@/lib/ui/load";
import { PRIORITIES, TASK_TYPES } from "@/lib/validation";
import { TaskFilters } from "./forms";
import { TaskGroups, type GroupBy } from "./task-list";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * The project and its tasks for one tab. Runs on every server request (private
 * caches are not stored on the server); the browser may reuse a prefetched copy
 * for 30 seconds, and any owner action clears it.
 */
async function loadTab(slug: string, filters: Filters) {
  "use cache: private";
  cacheLife({ stale: 30 });
  const db = getDb();
  const project = await orNotFound(getProjectBySlug(db, slug));
  const tasks = await listTasks(db, project, filters);
  return { project, tasks, now: new Date() };
}

/** A project tab listing tasks in the tab's statuses, with search and grouping. */
export async function TaskTab({
  tab,
  params,
  searchParams,
  empty,
}: {
  tab: TaskTabId;
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
  empty: { title: string; body?: string };
}) {
  await requireOwner();
  const { slug } = await params;
  const sp = await searchParams;
  const { statuses, path } = taskTab(tab);

  const group = (["status", "priority", "type"] as const).find((g) => g === one(sp.group)) ?? "status";
  const priority = (PRIORITIES as readonly string[]).includes(one(sp.priority)) ? one(sp.priority) : "";
  const type = (TASK_TYPES as readonly string[]).includes(one(sp.type)) ? one(sp.type) : "";
  const q = one(sp.q).slice(0, 200);
  const filtered = !!(q || priority || type);

  const { project, tasks, now } = await loadTab(slug, {
    q,
    priority,
    type,
    statuses,
    order: tab === "done" ? "recent" : "priority",
  });
  const href = path ? `/projects/${project.slug}/${path}` : `/projects/${project.slug}`;

  return (
    <div className="flex flex-col gap-5">
      <TaskFilters action={href} values={{ q, priority, type, group }} />
      <TaskGroups
        tasks={tasks}
        groupBy={group as GroupBy}
        projectKey={project.key}
        slug={project.slug}
        empty={filtered ? { title: "No tasks match these filters." } : empty}
        now={now}
      />
    </div>
  );
}
