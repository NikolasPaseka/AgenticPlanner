"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "./ui";

export type ProjectTab = {
  segment: string | null;
  label: string;
  count?: number;
  highlight?: boolean;
  /** Prefetch the tab's content too, not just its loading skeleton, so switching to it is instant. */
  prefetch?: boolean;
};

/** Tab bar under the project header. The active tab follows the URL. */
export function ProjectTabs({ slug, tabs }: { slug: string; tabs: ProjectTab[] }) {
  const active = useSelectedLayoutSegment();
  return (
    <nav aria-label="Project" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const current = tab.segment === active;
        return (
          <Link
            key={tab.label}
            href={tab.segment ? `/projects/${slug}/${tab.segment}` : `/projects/${slug}`}
            prefetch={tab.prefetch ? true : "auto"}
            aria-current={current ? "page" : undefined}
            aria-label={tab.count !== undefined ? `${tab.label} (${tab.count})` : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition",
              current ? "border-accent text-fg" : "border-transparent text-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 py-px text-center text-xs tabular-nums",
                  tab.highlight && tab.count > 0 ? "bg-accent text-accent-fg" : "bg-surface-3 text-muted",
                )}
              >
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
