"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, THEMES, type Theme } from "@/lib/ui/theme";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";
import { cn } from "./ui";

const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the choice still applies until the page reloads.
  }
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;
const LABEL = { light: "Light theme", dark: "Dark theme", system: "System theme" } as const;

/** Light, dark, or follow the system. Stored per browser. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  return (
    <div role="group" aria-label="Theme" className="flex shrink-0 items-center rounded-full border border-border p-0.5">
      {THEMES.map((t) => {
        const Icon = ICON[t];
        return (
          <button
            key={t}
            type="button"
            aria-pressed={theme === t}
            aria-label={LABEL[t]}
            title={LABEL[t]}
            onClick={() => applyTheme(t)}
            className={cn(
              "grid size-6 place-items-center rounded-full text-muted transition hover:text-fg",
              theme === t && "bg-surface-3 text-fg",
            )}
          >
            <Icon width={14} height={14} />
          </button>
        );
      })}
    </div>
  );
}
