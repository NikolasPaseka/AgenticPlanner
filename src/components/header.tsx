import Link from "next/link";
import { connection } from "next/server";
import { auth } from "@/auth";
import { setAgentsEnabledAction, signOutAction } from "@/app/actions";
import { getDb } from "@/lib/db";
import { getAppSettings } from "@/lib/services/settings";
import { timeAgo } from "@/lib/ui/labels";
import { ThemeToggle } from "./theme";
import { cn } from "./ui";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-bold text-white shadow-card"
      >
        AP
      </span>
      <span className="hidden sm:inline">AgentPlanner</span>
    </Link>
  );
}

function Bar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Logo />
        <div className="flex-1" />
        {children}
      </div>
    </header>
  );
}

export function HeaderShell() {
  return (
    <Bar>
      <ThemeToggle />
    </Bar>
  );
}

/** Global agents switch: off means no new agent runs start in any project. */
function AgentsSwitch({ enabled }: { enabled: boolean }) {
  return (
    <form action={setAgentsEnabledAction}>
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <button
        type="submit"
        role="switch"
        aria-checked={enabled}
        title={enabled ? "Pause all agents" : "Resume all agents"}
        className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1 text-sm shadow-card hover:bg-surface-2"
      >
        <span
          aria-hidden
          className={cn("relative h-4 w-7 rounded-full transition", enabled ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-600")}
        >
          <span
            className={cn("absolute top-0.5 size-3 rounded-full bg-white transition-all", enabled ? "left-3.5" : "left-0.5")}
          />
        </span>
        <span className="whitespace-nowrap">
          Agents<span className="hidden sm:inline">{enabled ? " on" : " paused"}</span>
        </span>
      </button>
    </form>
  );
}

export async function Header() {
  await connection();
  const session = await auth();
  const login = session?.user?.login;
  const settings = login ? await getAppSettings(getDb()) : null;
  return (
    <>
      <Bar>
        {settings && <AgentsSwitch enabled={settings.agentsEnabled} />}
        <ThemeToggle />
        {login && (
          <form action={signOutAction} className="flex items-center gap-2 border-l border-border pl-3">
            <span className="hidden text-sm text-muted md:inline">{login}</span>
            <button type="submit" className="text-sm whitespace-nowrap text-muted underline-offset-2 hover:text-fg hover:underline">
              Sign out
            </button>
          </form>
        )}
      </Bar>
      {settings && !settings.agentsEnabled && (
        <div
          role="status"
          className="border-b border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200"
        >
          <p className="mx-auto max-w-6xl px-4 py-2 text-sm">
            Agents are paused in all projects
            {settings.agentsPausedAt && ` since ${timeAgo(settings.agentsPausedAt)}`}. No new agent runs will start
            until you switch them back on.
          </p>
        </div>
      )}
    </>
  );
}
