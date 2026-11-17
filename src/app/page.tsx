export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-semibold">AgentPlanner</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        A shared task board for you and your AI agents. Agents implement and review; you approve,
        and Vercel ships.
      </p>
      <p className="text-sm text-zinc-500">Milestone M0: foundations are in place.</p>
    </main>
  );
}
