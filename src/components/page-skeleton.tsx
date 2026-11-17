export function PageSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 rounded bg-surface-2" />
      <div className="h-24 rounded-lg bg-surface-2" />
      <div className="h-48 rounded-lg bg-surface-2" />
    </div>
  );
}
