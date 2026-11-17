import Link from "next/link";
import { requireOwner } from "@/auth";
import { CreateProjectForm } from "@/components/forms";
import { Card } from "@/components/ui";
import { getDb } from "@/lib/db";
import type { TaskStatus } from "@/lib/domain/tasks";
import { listProjectsWithCounts } from "@/lib/services/projects";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/ui/labels";

const SUMMARY: TaskStatus[] = ["proposed", "in_review", "blocked", "in_progress", "todo"];

export default async function ProjectsPage() {
  await requireOwner();
  const projects = await listProjectsWithCounts(getDb());

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Projects</h1>

      {projects.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.slug}`} className="block h-full">
                <Card className="flex h-full flex-col gap-3 p-4 transition hover:border-accent">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="font-semibold">{p.name}</h2>
                    <span className="font-mono text-xs text-muted">{p.key}</span>
                  </div>
                  {p.description && <p className="line-clamp-2 text-sm text-muted">{p.description}</p>}
                  <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {SUMMARY.filter((s) => p.counts[s]).map((s) => (
                      <span key={s} className="flex items-center gap-1.5">
                        <span aria-hidden className={`size-1.5 rounded-full ${STATUS_DOT[s]}`} />
                        {p.counts[s]} {STATUS_LABEL[s].toLowerCase()}
                      </span>
                    ))}
                    {SUMMARY.every((s) => !p.counts[s]) && <span>No open tasks</span>}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Card className="p-4">
        <details open={projects.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold">+ New project</summary>
          <div className="pt-4">
            <CreateProjectForm />
          </div>
        </details>
      </Card>
    </div>
  );
}
