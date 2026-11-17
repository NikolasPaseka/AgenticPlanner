"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { devLoginEnabled, requireOwner, signIn, signOut } from "@/auth";
import { getDb } from "@/lib/db";
import { InvalidTransitionError, TASK_STATUSES } from "@/lib/domain/tasks";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/services/errors";
import { createProject, updateProjectSettings } from "@/lib/services/projects";
import { setAgentsEnabled } from "@/lib/services/settings";
import { createApiToken, revokeApiToken } from "@/lib/services/tokens";
import { getGitHub, GitHubNotConfiguredError } from "@/lib/github/gateway";
import { githubConfigured } from "@/lib/github/config";
import { approveAndMerge, connectRepository, rejectTask, requestChanges } from "@/lib/services/github";
import { scheduleDispatch } from "@/lib/dispatch-trigger";
import { dispatchTask, stopRun } from "@/lib/services/dispatch";
import { addComment, createTask, setTaskHold, transitionTask, updateTask } from "@/lib/services/tasks";

export type FormState = { error?: string; ok?: boolean } | undefined;

/** Turns expected failures into a message for the form; rethrows anything else. */
function toFormError(e: unknown): FormState {
  if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(". ") };
  if (
    e instanceof ConflictError ||
    e instanceof ValidationError ||
    e instanceof NotFoundError ||
    e instanceof GitHubNotConfiguredError ||
    e instanceof InvalidTransitionError
  ) {
    return { error: e.message };
  }
  throw e;
}

function refresh() {
  revalidatePath("/", "layout");
  // Any owner change can make a task ready for an agent; the dispatcher checks all switches.
  scheduleDispatch();
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "");

// --- Auth -------------------------------------------------------------------

export async function signInWithGitHub() {
  await signIn("github", { redirectTo: "/" });
}

export async function signInDev() {
  if (!devLoginEnabled) throw new Error("Development login is disabled");
  await signIn("dev", { redirectTo: "/" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}

// --- Global agents switch ---------------------------------------------------

export async function setAgentsEnabledAction(form: FormData) {
  const owner = await requireOwner();
  await setAgentsEnabled(getDb(), str(form, "enabled") === "true", owner);
  refresh();
}

// --- Projects ---------------------------------------------------------------

export async function createProjectAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  let slug: string;
  try {
    const project = await createProject(getDb(), {
      name: str(form, "name"),
      key: str(form, "key"),
      description: str(form, "description"),
      githubOwner: str(form, "githubOwner"),
      githubRepo: str(form, "githubRepo"),
    });
    slug = project.slug;
  } catch (e) {
    return toFormError(e);
  }
  refresh();
  redirect(`/projects/${slug}`);
}

export async function updateProjectSettingsAction(
  projectId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  await requireOwner();
  try {
    await updateProjectSettings(getDb(), projectId, {
      name: str(form, "name"),
      description: str(form, "description"),
      githubOwner: str(form, "githubOwner"),
      githubRepo: str(form, "githubRepo"),
      defaultBranch: str(form, "defaultBranch"),
      vercelProjectId: str(form, "vercelProjectId"),
      productionUrl: str(form, "productionUrl"),
      autoDispatch: form.get("autoDispatch") === "on",
      maxParallelRuns: Number(str(form, "maxParallelRuns")),
      maxProposalsPerRun: Number(str(form, "maxProposalsPerRun")),
      mergeMethod: str(form, "mergeMethod") as "merge",
    });
  } catch (e) {
    return toFormError(e);
  }
  refresh();
  return { ok: true };
}

// --- Tasks ------------------------------------------------------------------

function taskFields(form: FormData) {
  return {
    title: str(form, "title"),
    description: str(form, "description"),
    acceptanceCriteria: str(form, "acceptanceCriteria"),
    priority: str(form, "priority") as "medium",
    type: str(form, "type") as "feature",
    labels: str(form, "labels"),
  };
}

export async function createTaskAction(
  projectId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const owner = await requireOwner();
  try {
    await createTask(
      getDb(),
      projectId,
      { ...taskFields(form), status: str(form, "status") === "backlog" ? "backlog" : "todo" },
      owner,
    );
  } catch (e) {
    return toFormError(e);
  }
  refresh();
  return { ok: true };
}

export async function updateTaskAction(
  taskId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const owner = await requireOwner();
  try {
    await updateTask(getDb(), taskId, taskFields(form), owner);
  } catch (e) {
    return toFormError(e);
  }
  refresh();
  return { ok: true };
}

const statusSchema = z.enum(TASK_STATUSES);

export async function transitionTaskAction(form: FormData) {
  const owner = await requireOwner();
  const to = statusSchema.parse(str(form, "to"));
  if (to === "merged") throw new Error("Tasks are merged through the review flow");
  await transitionTask(getDb(), str(form, "taskId"), to, owner);
  refresh();
}

export async function setTaskHoldAction(form: FormData) {
  const owner = await requireOwner();
  await setTaskHold(getDb(), str(form, "taskId"), str(form, "onHold") === "true", owner);
  refresh();
}

export async function addCommentAction(
  taskId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const owner = await requireOwner();
  try {
    await addComment(getDb(), taskId, { body: str(form, "body") }, owner);
  } catch (e) {
    return toFormError(e);
  }
  refresh();
  return { ok: true };
}

// --- API tokens ---------------------------------------------------------------

export type TokenFormState = { error?: string; token?: string; name?: string } | undefined;

export async function createApiTokenAction(
  projectId: string,
  _prev: TokenFormState,
  form: FormData,
): Promise<TokenFormState> {
  const owner = await requireOwner();
  try {
    const { token, record } = await createApiToken(
      getDb(),
      projectId,
      { name: str(form, "name"), scopes: form.getAll("scopes").map(String) },
      owner,
    );
    refresh();
    return { token, name: record.name };
  } catch (e) {
    return toFormError(e);
  }
}

export async function revokeApiTokenAction(form: FormData) {
  const owner = await requireOwner();
  await revokeApiToken(getDb(), str(form, "tokenId"), owner);
  refresh();
}

// --- GitHub review flow -------------------------------------------------------

/** GitHub API errors carry a status and message; show them to the owner. */
function githubError(e: unknown): FormState {
  const err = e as { status?: number; message?: string };
  if (typeof err?.status === "number") return { error: `GitHub: ${err.message ?? `error ${err.status}`}` };
  return toFormError(e);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState passes the previous state
export async function connectRepositoryAction(projectId: string, _prev: FormState): Promise<FormState> {
  const owner = await requireOwner();
  try {
    await connectRepository(getDb(), getGitHub(), projectId, owner);
  } catch (e) {
    return githubError(e);
  }
  refresh();
  return { ok: true };
}

export async function approveAndMergeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  try {
    await approveAndMerge(getDb(), getGitHub(), str(form, "taskId"), str(form, "headSha") || null, owner);
  } catch (e) {
    return githubError(e);
  }
  refresh();
  return { ok: true };
}

export async function requestChangesAction(_prev: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  let warning: string | undefined;
  try {
    ({ warning } = await requestChanges(
      getDb(),
      githubConfigured() ? getGitHub() : null,
      str(form, "taskId"),
      str(form, "feedback"),
      owner,
    ));
  } catch (e) {
    return githubError(e);
  }
  refresh();
  return warning ? { error: warning } : { ok: true };
}

export async function rejectTaskAction(_prev: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  let warning: string | undefined;
  try {
    ({ warning } = await rejectTask(
      getDb(),
      githubConfigured() ? getGitHub() : null,
      str(form, "taskId"),
      str(form, "mode") === "todo" ? "todo" : "cancel",
      str(form, "reason"),
      owner,
    ));
  } catch (e) {
    return githubError(e);
  }
  refresh();
  return warning ? { error: warning } : { ok: true };
}

// --- Agent runs -----------------------------------------------------------------

export async function dispatchTaskAction(_prev: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  try {
    await dispatchTask(getDb(), getGitHub(), str(form, "taskId"), owner);
  } catch (e) {
    return githubError(e);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function stopRunAction(_prev: FormState, form: FormData): Promise<FormState> {
  const owner = await requireOwner();
  let warning: string | undefined;
  try {
    ({ warning } = await stopRun(
      getDb(),
      githubConfigured() ? getGitHub() : null,
      str(form, "runId"),
      str(form, "mode") === "blocked" ? "blocked" : "todo",
      owner,
    ));
  } catch (e) {
    return githubError(e);
  }
  revalidatePath("/", "layout");
  return warning ? { error: warning } : { ok: true };
}
