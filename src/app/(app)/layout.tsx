import { Suspense, type ReactNode } from "react";
import { Header, HeaderShell } from "@/components/header";
import { PageSkeleton } from "@/components/page-skeleton";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<HeaderShell />}>
        <Header />
      </Suspense>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
      </main>
    </>
  );
}
