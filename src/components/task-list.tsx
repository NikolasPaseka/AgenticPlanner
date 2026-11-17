import Link from "next/link";
import { transitionTaskAction } from "@/app/actions";
import type { TaskStatus } from "@/lib/domain/tasks";
import type { Task } from "@/lib/services/tasks";
import {
  PRIORITY_CLASS,
  PRIORITY_LABEL,
  STATUS_DOT,
  STATUS_GROUP_ORDER,
  STATUS_LABEL,
  TYPE_LABEL,
} from "@/lib/ui/labels";
import { PRIORITIES, TASK_TYPES } from "@/lib/validation";
import { Badge, Button, cn } from "./ui";

export type GroupBy = "status" | "priority" | "type";

type Group = { id: string; title: string; dot?: string; tasks: Task[]; collapsed?: boolean };

const CLOSED: TaskStatus[] = ["merged", "done", "cancelled"];

export function groupTasks(tasks: Task[], groupBy: GroupBy): Group[] {
  const make = <K extends string>(keys: readonly K[], get: (t: Task) => K, title: (k: K) => string) =>
    keys
      .map((k) => ({ id: k as string, title: title(k), tasks: tasks.filter((t) => get(t) === k) }))
      .filter((g) => g.tasks.length > 0);

  if (groupBy === "priority") return make(PRIORITIES, (t) => t.priority, (k) => PRIORITY_LABEL[k]);
  if (groupBy === "type") return make(TASK_TYPES, (t) => t.type, (k) => TYPE_LABEL[k]);
  return make(STATUS_GROUP_ORDER, (t) => t.status, (k) => STATUS_LABEL[k]).map((g) => ({
    ...g,
    dot: STATUS_DOT[g.id as TaskStatus],
    collapsed: CLOSED.includes(g.id as TaskStatus),
  }));
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge>
      <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function ProposalActions({ taskId }: { taskId: string }) {
  return (
    <div className="flex shrink-0 gap-1.5">
      <form action={transitionTaskAction}>
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="to" value="todo" />
        <Button size="sm" variant="primary" type="submit">
          Accept
        </Button>
      </form>
      <form action={transitionTaskAction}>
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="to" value="cancelled" />
        <Button size="sm" variant="ghost" type="submit">
          Reject
        </Button>
      </form>
    </div>
  );
}

function TaskRow({
  task,
  projectKey,
  slug,
  showStatus,
}: {
  task: Task;
  projectKey: string;
  slug: string;
  showStatus: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
      <span className={cn("w-14 shrink-0 text-xs font-medium", PRIORITY_CLASS[task.priority])}>
        {PRIORITY_LABEL[task.priority]}
      </span>
      <Link href={`/projects/${slug}/tasks/${task.number}`} className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-muted">
          {projectKey}-{task.number}
        </span>
        <span className="truncate text-sm font-medium">{task.title}</span>
      </Link>
      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
        {task.onHold && <Badge className="text-amber-700 dark:text-amber-300">On hold</Badge>}
        {task.source === "agent" && <Badge className="text-violet-700 dark:text-violet-300">Agent</Badge>}
        {task.labels.slice(0, 2).map((l) => (
          <Badge key={l} className="text-muted">
            {l}
          </Badge>
        ))}
        <Badge className="text-muted">{TYPE_LABEL[task.type]}</Badge>
        {showStatus && <StatusBadge status={task.status} />}
        {task.prUrl && (
          <a href={task.prUrl} className="text-xs text-accent hover:underline" target="_blank" rel="noreferrer">
            PR #{task.prNumber}
          </a>
        )}
      </div>
      {task.status === "proposed" && <ProposalActions taskId={task.id} />}
    </li>
  );
}

export function TaskGroups({
  tasks,
  groupBy,
  projectKey,
  slug,
}: {
  tasks: Task[];
  groupBy: GroupBy;
  projectKey: string;
  slug: string;
}) {
  const groups = groupTasks(tasks, groupBy);
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
        No tasks match. Add one above, or clear the filters.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <details key={g.id} open={!g.collapsed} className="group rounded-lg border border-border bg-surface">
          <summary className="flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 select-none hover:bg-surface-2">
            <span aria-hidden className="text-[10px] text-muted transition group-open:rotate-90">
              ▶
            </span>
            {g.dot && <span aria-hidden className={cn("size-2 rounded-full", g.dot)} />}
            <h2 className="text-sm font-semibold">{g.title}</h2>
            <span className="text-xs text-muted">{g.tasks.length}</span>
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {g.tasks.map((t) => (
              <TaskRow key={t.id} task={t} projectKey={projectKey} slug={slug} showStatus={groupBy !== "status"} />
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
