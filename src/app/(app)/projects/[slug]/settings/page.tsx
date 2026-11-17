import Link from "next/link";
import { requireOwner } from "@/auth";
import { ProjectSettingsForm } from "@/components/forms";
import { Card } from "@/components/ui";
import { getDb } from "@/lib/db";
import { getProjectBySlug } from "@/lib/services/projects";
import { orNotFound } from "@/lib/ui/load";

export default async function ProjectSettingsPage({ params }: PageProps<"/projects/[slug]/settings">) {
  await requireOwner();
  const { slug } = await params;
  const project = await orNotFound(getProjectBySlug(getDb(), slug));
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
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>
      <Card className="p-4">
        <ProjectSettingsForm project={project} />
      </Card>
    </div>
  );
}
