"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { dispatchTaskAction, stopRunAction } from "@/app/actions";
import { Button, FormError, inputClass } from "./ui";

function Submit({ children, pendingText, variant = "secondary" }: { children: string; pendingText: string; variant?: "primary" | "secondary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}

/** Stop a running agent: cancels the GitHub Actions run and holds the task. */
export function StopRunButton({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(stopRunAction, undefined);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="danger" onClick={() => setOpen(true)}>
        Stop
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="runId" value={runId} />
      <label className="text-xs text-muted" htmlFor={`stop-mode-${runId}`}>
        The branch is kept. Then move the task to:
      </label>
      <select id={`stop-mode-${runId}`} name="mode" defaultValue="todo" className={`${inputClass} py-1 text-xs`}>
        <option value="todo">Todo (on hold)</option>
        <option value="blocked">Blocked (on hold)</option>
      </select>
      <div className="flex items-center gap-2">
        <Submit variant="danger" pendingText="Stopping…">
          Stop agent
        </Submit>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Keep running
        </Button>
      </div>
      <FormError message={state?.error} />
    </form>
  );
}

export function RunAgentNowButton({ taskId }: { taskId: string }) {
  const [state, action] = useActionState(dispatchTaskAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="taskId" value={taskId} />
      <Submit variant="primary" pendingText="Starting…">
        Run agent now
      </Submit>
      <FormError message={state?.error} />
    </form>
  );
}
