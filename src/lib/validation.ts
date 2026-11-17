import { z } from "zod";

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const TASK_TYPES = ["feature", "bug", "chore", "refactor", "docs", "test", "security"] as const;
export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const projectInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, "Key must be 2–10 letters or digits, starting with a letter"),
  description: optionalText,
  githubOwner: optionalText,
  githubRepo: optionalText,
});
export type ProjectInput = z.input<typeof projectInput>;

export const projectSettingsInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: optionalText,
  githubOwner: optionalText,
  githubRepo: optionalText,
  defaultBranch: z.string().trim().min(1).default("main"),
  vercelProjectId: optionalText,
  productionUrl: optionalText.pipe(z.url().nullable().optional()),
  autoDispatch: z.boolean(),
  maxParallelRuns: z.coerce.number().int().min(1).max(10),
  maxProposalsPerRun: z.coerce.number().int().min(0).max(50),
  mergeMethod: z.enum(MERGE_METHODS),
});
export type ProjectSettingsInput = z.input<typeof projectSettingsInput>;

const labels = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(",")))
  .transform((arr) => [...new Set(arr.map((l) => l.trim().toLowerCase()).filter(Boolean))]);

const taskFields = {
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(20000),
  acceptanceCriteria: z.string().trim().max(20000),
  priority: z.enum(PRIORITIES),
  type: z.enum(TASK_TYPES),
  labels,
};

export const taskInput = z.object({
  ...taskFields,
  description: taskFields.description.default(""),
  acceptanceCriteria: taskFields.acceptanceCriteria.default(""),
  priority: taskFields.priority.default("medium"),
  type: taskFields.type.default("feature"),
  labels: labels.default([]),
});
export type TaskInput = z.input<typeof taskInput>;

/** Partial update: omitted fields stay unchanged (no defaults). */
export const taskUpdateInput = z.object(taskFields).partial();
export type TaskUpdateInput = z.input<typeof taskUpdateInput>;

export const commentInput = z.object({
  body: z.string().trim().min(1, "Comment is empty").max(20000),
});
