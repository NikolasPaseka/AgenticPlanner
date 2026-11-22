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

/**
 * Approve, request changes, or reject a pull request in review. After a
 * decision succeeds, the server action redirects to doneHref (the review queue).
 */
export function ReviewActions({ taskId, headSha, doneHref }: { taskId: string; headSha: string | null; doneHref: string }) {
  const [mode, setMode] = useState<"none" | "changes" | "reject">("none");
  const [approveState, approve] = useActionState(approveAndMergeAction, undefined);
  const [changesState, changes] = useActionState(requestChangesAction, undefined);
  const [rejectState, reject] = useActionState(rejectTaskAction, undefined);
  const next = <input type="hidden" name="next" value={doneHref} />;

  return (
    <div className="flex flex-col gap-2">
      <form action={approve} className="flex flex-col">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="headSha" value={headSha ?? ""} />
        {next}
        <Submit variant="primary" pendingText="Merging…">
          Approve and merge
        </Submit>
      </form>
      <FormError message={approveState?.error} />
      <div className="flex flex-col gap-2">
        <Button type="button" onClick={() => setMode(mode === "changes" ? "none" : "changes")} aria-expanded={mode === "changes"}>
          Request changes
        </Button>
        <Button type="button" variant="danger" onClick={() => setMode(mode === "reject" ? "none" : "reject")} aria-expanded={mode === "reject"}>
          Reject
        </Button>
      </div>

      {mode === "changes" && (
        <form action={changes} className="flex flex-col gap-2 pt-2">
          <input type="hidden" name="taskId" value={taskId} />
          {next}
          <label className="text-sm font-medium" htmlFor={`feedback-${taskId}`}>
            What should change? The developer agent gets this as feedback.
          </label>
          <textarea id={`feedback-${taskId}`} name="feedback" required rows={4} className={inputClass} />
          <Submit pendingText="Sending…">Send back to agent</Submit>
          <FormError message={changesState?.error} />
        </form>
      )}

      {mode === "reject" && (
        <form action={reject} className="flex flex-col gap-2 pt-2">
          <input type="hidden" name="taskId" value={taskId} />
          {next}
          <label className="text-sm font-medium" htmlFor={`reason-${taskId}`}>
            Reason (optional)
          </label>
          <textarea id={`reason-${taskId}`} name="reason" rows={3} className={inputClass} />
          <select name="mode" defaultValue="cancel" className={inputClass} aria-label="After rejecting">
            <option value="cancel">Close PR and cancel the task</option>
            <option value="todo">Close PR and return the task to Todo</option>
          </select>
          <Submit variant="danger" pendingText="Rejecting…">
            Reject
          </Submit>
          <FormError message={rejectState?.error} />
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
