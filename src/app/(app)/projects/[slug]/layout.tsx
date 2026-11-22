import { Suspense } from "react";
import { ProjectHeader, ProjectHeaderSkeleton } from "@/components/project-header";

export default function ProjectLayout({ children, params }: LayoutProps<"/projects/[slug]">) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<ProjectHeaderSkeleton />}>
        <ProjectHeader params={params} />
      </Suspense>
      {children}
    </div>
  );
}
