"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  approveAndMergeAction,
  connectRepositoryAction,
  rejectTaskAction,
  requestChangesAction,
} from "@/app/actions";
import { Button, FormError, inputClass } from "./ui";

function Submit({ children, variant = "secondary", pendingText }: { children: string; variant?: "primary" | "secondary" | "danger"; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function ReviewActions({ taskId, headSha }: { taskId: string; headSha: string | null }) {
  const [mode, setMode] = useState<"none" | "changes" | "reject">("none");
  const [approveState, approve] = useActionState(approveAndMergeAction, undefined);
  const [changesState, changes] = useActionState(requestChangesAction, undefined);
  const [rejectState, reject] = useActionState(rejectTaskAction, undefined);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form action={approve}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="headSha" value={headSha ?? ""} />
          <Submit variant="primary" pendingText="Merging…">
            Approve and merge
          </Submit>
        </form>
        <Button type="button" onClick={() => setMode(mode === "changes" ? "none" : "changes")} aria-expanded={mode === "changes"}>
          Request changes
        </Button>
        <Button type="button" variant="danger" onClick={() => setMode(mode === "reject" ? "none" : "reject")} aria-expanded={mode === "reject"}>
          Reject
        </Button>
      </div>
      <FormError message={approveState?.error} />

      {mode === "changes" && (
        <form action={changes} className="flex flex-col gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <label className="text-sm font-medium" htmlFor={`feedback-${taskId}`}>
            What should change? The developer agent gets this as feedback.
          </label>
          <textarea id={`feedback-${taskId}`} name="feedback" required rows={3} className={inputClass} />
          <div className="flex items-center gap-3">
            <Submit pendingText="Sending…">Send back to agent</Submit>
            <FormError message={changesState?.error} />
          </div>
        </form>
      )}

      {mode === "reject" && (
        <form action={reject} className="flex flex-col gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <label className="text-sm font-medium" htmlFor={`reason-${taskId}`}>
            Reason (optional)
          </label>
          <textarea id={`reason-${taskId}`} name="reason" rows={2} className={inputClass} />
          <div className="flex flex-wrap items-center gap-3">
            <select name="mode" defaultValue="cancel" className={`${inputClass} w-auto`} aria-label="After rejecting">
              <option value="cancel">Close PR and cancel the task</option>
              <option value="todo">Close PR and return the task to Todo</option>
            </select>
            <Submit variant="danger" pendingText="Rejecting…">
              Reject
            </Submit>
            <FormError message={rejectState?.error} />
          </div>
        </form>
      )}
    </div>
  );
}

export function ConnectRepositoryButton({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(connectRepositoryAction.bind(null, projectId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Submit pendingText="Checking…">Connect</Submit>
      <FormError message={state?.error} />
      {state?.ok && <span className="text-sm text-muted">Connected.</span>}
    </form>
  );
}
