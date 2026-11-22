import { TaskTab } from "@/components/task-tab";

/** In progress tab: tasks agents are working on, sent back, or blocked. */
export default function InProgressPage({ params, searchParams }: PageProps<"/projects/[slug]/in-progress">) {
  return (
    <TaskTab
      tab="in-progress"
      params={params}
      searchParams={searchParams}
      empty={{ title: "No work in progress.", body: "Tasks appear here when an agent starts them." }}
    />
  );
}
