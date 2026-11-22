import { TaskTab } from "@/components/task-tab";

/** Planned tab: proposals from agents, Todo, and Backlog. */
export default function PlannedPage({ params, searchParams }: PageProps<"/projects/[slug]">) {
  return (
    <TaskTab
      tab="planned"
      params={params}
      searchParams={searchParams}
      empty={{
        title: "Nothing planned yet.",
        body: "Add a task with New task. Tasks in Todo are picked up by agents in priority order.",
      }}
    />
  );
}
