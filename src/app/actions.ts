"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { devLoginEnabled, requireOwner, signIn, signOut } from "@/auth";
import { getDb } from "@/lib/db";
import { TASK_STATUSES } from "@/lib/domain/tasks";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/services/errors";
import { createProject, updateProjectSettings } from "@/lib/services/projects";
import { setAgentsEnabled } from "@/lib/services/settings";
import { addComment, createTask, setTaskHold, transitionTask, updateTask } from "@/lib/services/tasks";

export type FormState = { error?: string; ok?: boolean } | undefined;

/** Turns expected failures into a message for the form; rethrows anything else. */
function toFormError(e: unknown): FormState {
  if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(". ") };
  if (e instanceof ConflictError || e instanceof ValidationError || e instanceof NotFoundError) {
    return { error: e.message };
  }
  throw e;
}

function refresh() {
  revalidatePath("/", "layout");
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
