import { Badge } from "./ui";

const CLASS: Record<string, string> = {
  queued: "text-sky-700 dark:text-sky-300",
  running: "text-amber-700 dark:text-amber-300",
  succeeded: "text-emerald-700 dark:text-emerald-300",
  failed: "text-red-600 dark:text-red-400",
  cancelled: "text-muted",
};

export function RunStatusBadge({ status }: { status: string }) {
  return <Badge className={CLASS[status] ?? "text-muted"}>{status}</Badge>;
}
