import { TaskTab } from "@/components/task-tab";

/** Done tab: merged, deployed, and cancelled tasks, most recent first. */
export default function DonePage({ params, searchParams }: PageProps<"/projects/[slug]/done">) {
  return (
    <TaskTab
      tab="done"
      params={params}
      searchParams={searchParams}
      empty={{ title: "Nothing finished yet.", body: "Merged and cancelled tasks are listed here." }}
    />
  );
}
