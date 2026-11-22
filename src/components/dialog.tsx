"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "./icons";
import { Button, cn } from "./ui";

const CloseContext = createContext<() => void>(() => {});

/** Lets content inside a dialog (for example a form after saving) close it. */
export const useCloseDialog = () => useContext(CloseContext);

/** A button that opens a native modal dialog. Escape and the close button dismiss it. */
export function DialogButton({
  label,
  title,
  icon,
  variant = "primary",
  className,
  children,
}: {
  label: string;
  title: string;
  icon?: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => ref.current?.close(), []);
  // Close after navigating away, for example when creating a project opens its page.
  const pathname = usePathname();
  useEffect(() => close(), [pathname, close]);
  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => ref.current?.showModal()}>
        {icon}
        {label}
      </Button>
      <dialog
        ref={ref}
        aria-label={title}
        // Clicking the backdrop (the dialog element itself, outside the panel) closes it.
        onClick={(e) => e.target === e.currentTarget && close()}
        className={cn(
          "m-auto w-[calc(100%-2rem)] max-w-2xl rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            <XIcon />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-5">
          <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
        </div>
      </dialog>
    </>
  );
}
