import { requireOwner } from "@/auth";
import { getDb } from "@/lib/db";
import { getProjectBySlug } from "@/lib/services/projects";
import { listTasks } from "@/lib/services/tasks";
import { taskTab, type TaskTabId } from "@/lib/ui/tabs";
import { orNotFound } from "@/lib/ui/load";
import { PRIORITIES, TASK_TYPES } from "@/lib/validation";
import { TaskFilters } from "./forms";
import { TaskGroups, type GroupBy } from "./task-list";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

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
  const db = getDb();
  const project = await orNotFound(getProjectBySlug(db, slug));
  const { statuses, path } = taskTab(tab);

  const group = (["status", "priority", "type"] as const).find((g) => g === one(sp.group)) ?? "status";
  const priority = (PRIORITIES as readonly string[]).includes(one(sp.priority)) ? one(sp.priority) : "";
  const type = (TASK_TYPES as readonly string[]).includes(one(sp.type)) ? one(sp.type) : "";
  const q = one(sp.q).slice(0, 200);
  const filtered = !!(q || priority || type);

  const tasks = await listTasks(db, project, {
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
      />
    </div>
  );
}
