import Link from "next/link";
import { requireOwner } from "@/auth";
import { DialogButton } from "@/components/dialog";
import { CreateProjectForm } from "@/components/forms";
import { PlusIcon } from "@/components/icons";
import { Badge, Card, EmptyState } from "@/components/ui";
import { getDb } from "@/lib/db";
import { listProjectsWithCounts } from "@/lib/services/projects";
import { tabCount } from "@/lib/ui/tabs";

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={highlight && value > 0 ? "text-lg font-semibold text-accent" : "text-lg font-semibold"}>
        {value}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

export default async function ProjectsPage() {
  await requireOwner();
  const projects = await listProjectsWithCounts(getDb());
  const newProject = (
    <DialogButton label="New project" title="New project" icon={<PlusIcon />}>
      <CreateProjectForm />
    </DialogButton>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted">Each project has its own backlog, agents, and repository.</p>
        </div>
        {projects.length > 0 && newProject}
      </div>

      {projects.length === 0 ? (
        <EmptyState title="No projects yet.">
          <div className="flex flex-col items-center gap-4">
            <p>Create a project, add tasks, and connect its GitHub repository when you are ready for agents.</p>
            {newProject}
          </div>
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.slug}`} className="block h-full">
                <Card className="flex h-full flex-col gap-4 p-5 transition hover:border-accent">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold">{p.name}</h2>
                    <Badge className="font-mono text-muted">{p.key}</Badge>
                  </div>
                  {p.description && <p className="line-clamp-2 text-sm text-muted">{p.description}</p>}
                  <div className="mt-auto grid grid-cols-4 gap-2 border-t border-border pt-3">
                    <Stat label="Planned" value={tabCount(p.counts, "planned")} />
                    <Stat label="Active" value={tabCount(p.counts, "in-progress")} />
                    <Stat label="Review" value={tabCount(p.counts, "review")} highlight />
                    <Stat label="Done" value={tabCount(p.counts, "done")} />
                  </div>
                  {!!p.counts.proposed && (
                    <p className="-mt-1 text-xs text-violet-700 dark:text-violet-300">
                      {p.counts.proposed} proposed by agents
                    </p>
                  )}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
