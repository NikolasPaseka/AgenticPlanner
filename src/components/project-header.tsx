import Link from "next/link";
import { requireOwner } from "@/auth";
import { getDb } from "@/lib/db";
import { countTasksByStatus, getProjectBySlug } from "@/lib/services/projects";
import { tabCount } from "@/lib/ui/tabs";
import { orNotFound } from "@/lib/ui/load";
import { DialogButton } from "./dialog";
import { NewTaskForm } from "./forms";
import { ExternalIcon, PlusIcon } from "./icons";
import { ProjectTabs } from "./project-tabs";
import { Badge } from "./ui";

/** Project name, links, the New task button, and the tab bar. Shown on every project page. */
export async function ProjectHeader({ params }: { params: Promise<{ slug: string }> }) {
  await requireOwner();
  const { slug } = await params;
  const db = getDb();
  const project = await orNotFound(getProjectBySlug(db, slug));
  const counts = await countTasksByStatus(db, project.id);
  const repo = project.githubOwner && project.githubRepo ? `${project.githubOwner}/${project.githubRepo}` : null;

  return (
    <div className="flex flex-col gap-4 border-b border-border">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            <Link href="/" className="hover:text-fg hover:underline">
              Projects
            </Link>
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <Badge className="font-mono text-muted">{project.key}</Badge>
            {!project.settings.autoDispatch && <Badge className="text-muted">Auto-dispatch off</Badge>}
          </div>
          {(repo || project.productionUrl) && (
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {repo && (
                <a
                  href={`https://github.com/${repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-fg hover:underline"
                >
                  {repo}
                  <ExternalIcon width={12} height={12} />
                </a>
              )}
              {project.productionUrl && (
                <a
                  href={project.productionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-fg hover:underline"
                >
                  {new URL(project.productionUrl).host}
                  <ExternalIcon width={12} height={12} />
                </a>
              )}
            </p>
          )}
        </div>
        <DialogButton label="New task" title="New task" icon={<PlusIcon />}>
          <NewTaskForm projectId={project.id} />
        </DialogButton>
      </div>
      <ProjectTabs
        slug={project.slug}
        tabs={[
          { segment: null, label: "Planned", count: tabCount(counts, "planned"), highlight: !!counts.proposed },
          { segment: "in-progress", label: "In progress", count: tabCount(counts, "in-progress") },
          { segment: "review", label: "Review", count: tabCount(counts, "review"), highlight: true },
          { segment: "done", label: "Done", count: tabCount(counts, "done") },
          { segment: "runs", label: "Runs" },
          { segment: "settings", label: "Settings" },
        ]}
      />
    </div>
  );
}

export function ProjectHeaderSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4 border-b border-border pb-3" aria-hidden>
      <div className="h-4 w-16 rounded bg-surface-2" />
      <div className="h-8 w-64 rounded bg-surface-2" />
      <div className="h-6 w-96 max-w-full rounded bg-surface-2" />
    </div>
  );
}
