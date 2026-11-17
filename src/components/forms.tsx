"use client";

import Form from "next/form";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  addCommentAction,
  createProjectAction,
  createTaskAction,
  updateProjectSettingsAction,
  updateTaskAction,
  type FormState,
} from "@/app/actions";
import type { Project } from "@/lib/services/projects";
import type { Task } from "@/lib/services/tasks";
import { PRIORITY_LABEL, TYPE_LABEL } from "@/lib/ui/labels";
import { MERGE_METHODS, PRIORITIES, TASK_TYPES } from "@/lib/validation";
import { Button, Field, FormError, inputClass } from "./ui";

function SubmitButton({ children, pendingText }: { children: ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}

function Saved({ state }: { state: FormState }) {
  return state?.ok ? <span className="text-sm text-muted">Saved.</span> : null;
}

export function CreateProjectForm() {
  const [state, action] = useActionState(createProjectAction, undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Name">
        <input name="name" required maxLength={100} className={inputClass} placeholder="Agent Planner" />
      </Field>
      <Field label="Task key" hint="Prefix for task IDs, e.g. AP gives AP-1">
        <input
          name="key"
          required
          pattern="[A-Za-z][A-Za-z0-9]{1,9}"
          className={`${inputClass} uppercase`}
          placeholder="AP"
        />
      </Field>
      <Field label="GitHub owner">
        <input name="githubOwner" className={inputClass} placeholder="your-github-login" />
      </Field>
      <Field label="GitHub repository">
        <input name="githubRepo" className={inputClass} placeholder="repo-name" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Description">
          <textarea name="description" rows={2} className={inputClass} />
        </Field>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <SubmitButton pendingText="Creating…">Create project</SubmitButton>
        <FormError message={state?.error} />
      </div>
    </form>
  );
}

function TaskFields({ task }: { task?: Task }) {
  return (
    <>
      <Field label="Title">
        <input name="title" required maxLength={200} defaultValue={task?.title} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Priority">
          <select name="priority" defaultValue={task?.priority ?? "medium"} className={inputClass}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select name="type" defaultValue={task?.type ?? "feature"} className={inputClass}>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Labels" hint="Comma-separated">
          <input name="labels" defaultValue={task?.labels.join(", ")} className={inputClass} placeholder="ui, api" />
        </Field>
      </div>
      <Field label="Description" hint="What and why. Agents read this.">
        <textarea name="description" rows={5} defaultValue={task?.description} className={inputClass} />
      </Field>
      <Field label="Acceptance criteria" hint="What must be true for this task to be done.">
        <textarea
          name="acceptanceCriteria"
          rows={4}
          defaultValue={task?.acceptanceCriteria}
          className={inputClass}
          placeholder={"- Users can …\n- Tests cover …"}
        />
      </Field>
    </>
  );
}

export function NewTaskForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(createTaskAction.bind(null, projectId), undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <TaskFields />
      <div className="flex flex-wrap items-center gap-3">
        <select name="status" defaultValue="todo" className={`${inputClass} w-auto`} aria-label="Initial status">
          <option value="todo">Add to Todo (agents can pick it up)</option>
          <option value="backlog">Add to Backlog (not ready yet)</option>
        </select>
        <SubmitButton pendingText="Adding…">Add task</SubmitButton>
        <FormError message={state?.error} />
        {state?.ok && <span className="text-sm text-muted">Task added.</span>}
      </div>
    </form>
  );
}

export function EditTaskForm({ task }: { task: Task }) {
  const [state, action] = useActionState(updateTaskAction.bind(null, task.id), undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <TaskFields task={task} />
      <div className="flex items-center gap-3">
        <SubmitButton>Save changes</SubmitButton>
        <FormError message={state?.error} />
        <Saved state={state} />
      </div>
    </form>
  );
}

export function CommentForm({ taskId }: { taskId: string }) {
  const [state, action] = useActionState(addCommentAction.bind(null, taskId), undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="comment-body" className="sr-only">
        Comment
      </label>
      <textarea
        id="comment-body"
        name="body"
        required
        rows={3}
        className={inputClass}
        placeholder="Add a comment or instructions for the agent…"
      />
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Posting…">Comment</SubmitButton>
        <FormError message={state?.error} />
      </div>
    </form>
  );
}

export function ProjectSettingsForm({ project }: { project: Project }) {
  const [state, action] = useActionState(updateProjectSettingsAction.bind(null, project.id), undefined);
  const s = project.settings;
  return (
    <form action={action} className="flex flex-col gap-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input name="name" required defaultValue={project.name} className={inputClass} />
        </Field>
        <Field label="Task key" hint="Cannot be changed after tasks exist.">
          <input value={project.key} disabled className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea name="description" rows={2} defaultValue={project.description ?? ""} className={inputClass} />
          </Field>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <h2 className="text-sm font-semibold sm:col-span-3">GitHub and Vercel</h2>
        <Field label="GitHub owner">
          <input name="githubOwner" defaultValue={project.githubOwner ?? ""} className={inputClass} />
        </Field>
        <Field label="GitHub repository">
          <input name="githubRepo" defaultValue={project.githubRepo ?? ""} className={inputClass} />
        </Field>
        <Field label="Default branch">
          <input name="defaultBranch" defaultValue={project.defaultBranch} className={inputClass} />
        </Field>
        <Field label="Vercel project ID">
          <input name="vercelProjectId" defaultValue={project.vercelProjectId ?? ""} className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Production URL">
            <input
              name="productionUrl"
              type="url"
              defaultValue={project.productionUrl ?? ""}
              className={inputClass}
              placeholder="https://…"
            />
          </Field>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <h2 className="text-sm font-semibold sm:col-span-3">Agents</h2>
        <label className="flex items-start gap-3 text-sm sm:col-span-3">
          <input type="checkbox" name="autoDispatch" defaultChecked={s.autoDispatch} className="mt-1 size-4" />
          <span>
            <span className="font-medium">Auto-dispatch</span>
            <span className="block text-muted">
              Agents pick up Todo tasks by priority. The global agents switch in the header overrides this.
            </span>
          </span>
        </label>
        <Field label="Parallel agent runs">
          <input
            name="maxParallelRuns"
            type="number"
            min={1}
            max={10}
            defaultValue={s.maxParallelRuns}
            className={inputClass}
          />
        </Field>
        <Field label="Max proposals per run" hint="Tasks an analyzer may propose at once.">
          <input
            name="maxProposalsPerRun"
            type="number"
            min={0}
            max={50}
            defaultValue={s.maxProposalsPerRun}
            className={inputClass}
          />
        </Field>
        <Field label="Merge method">
          <select name="mergeMethod" defaultValue={s.mergeMethod} className={inputClass}>
            {MERGE_METHODS.map((m) => (
              <option key={m} value={m}>
                {m === "merge" ? "Merge commit" : m === "squash" ? "Squash" : "Rebase"}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <div className="flex items-center gap-3">
        <SubmitButton>Save settings</SubmitButton>
        <FormError message={state?.error} />
        <Saved state={state} />
      </div>
    </form>
  );
}

export type FilterValues = { q: string; priority: string; type: string; group: string; closed: boolean };

/** GET form that updates the URL on change, so filters are shareable and survive reloads. */
export function TaskFilters({ action, values }: { action: string; values: FilterValues }) {
  return (
    <Form
      action={action}
      className="flex flex-wrap items-end gap-2"
      onChange={(e) => {
        // Selects and checkboxes apply immediately; the search box applies on Enter.
        const target = e.target as unknown as HTMLInputElement;
        if (target.tagName !== "INPUT" || target.type === "checkbox") e.currentTarget.requestSubmit();
      }}
    >
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
        Search
        <input name="q" defaultValue={values.q} placeholder="Title or key, e.g. AP-12" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Group by
        <select name="group" defaultValue={values.group} className={inputClass}>
          <option value="status">Status</option>
          <option value="priority">Priority</option>
          <option value="type">Type</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Priority
        <select name="priority" defaultValue={values.priority} className={inputClass}>
          <option value="">All</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Type
        <select name="type" defaultValue={values.type} className={inputClass}>
          <option value="">All</option>
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input type="checkbox" name="closed" value="1" defaultChecked={values.closed} className="size-4" />
        Show closed
      </label>
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </Form>
  );
}
