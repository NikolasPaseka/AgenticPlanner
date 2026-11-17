"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createApiTokenAction } from "@/app/actions";
import { SCOPE_LABEL, TOKEN_SCOPES } from "@/lib/scopes";
import { Button, Field, FormError, inputClass } from "./ui";

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Creating…" : "Create token"}
    </Button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function CreateTokenForm({ projectId, appUrl }: { projectId: string; appUrl: string }) {
  const [state, action] = useActionState(createApiTokenAction.bind(null, projectId), undefined);
  const command = state?.token
    ? `claude mcp add --transport http agentplanner ${appUrl}/api/mcp --header "Authorization: Bearer ${state.token}"`
    : "";
  return (
    <div className="flex flex-col gap-4">
      {state?.token && (
        <div role="status" className="flex flex-col gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
          <p className="text-sm font-medium">
            Token &quot;{state.name}&quot; created. Copy it now: it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-xs" data-testid="new-token">
              {state.token}
            </code>
            <CopyButton text={state.token} />
          </div>
          <p className="text-xs text-muted">Connect Claude Code to this project:</p>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-xs whitespace-pre">
              {command}
            </code>
            <CopyButton text={command} />
          </div>
        </div>
      )}
      <form action={action} className="flex flex-col gap-3">
        <Field label="Agent name" hint="Shown as the author of the agent's comments and tasks, e.g. claude-dev.">
          <input name="name" required maxLength={50} pattern="[\w.\-]+" className={inputClass} placeholder="claude-dev" />
        </Field>
        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="mb-1.5 font-medium">Permissions</legend>
          {TOKEN_SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input type="checkbox" name="scopes" value={s} defaultChecked className="size-4" />
              {SCOPE_LABEL[s]} <span className="font-mono text-xs text-muted">{s}</span>
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-3">
          <CreateButton />
          <FormError message={state?.error} />
        </div>
      </form>
    </div>
  );
}
