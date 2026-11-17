import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  numeric,
  bigint,
  boolean,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Keep in sync with docs/data-model.md and src/lib/domain/tasks.ts.

export const taskStatus = pgEnum("task_status", [
  "proposed",
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "changes_requested",
  "merged",
  "done",
  "cancelled",
]);
export const taskPriority = pgEnum("task_priority", ["urgent", "high", "medium", "low"]);
export const taskType = pgEnum("task_type", [
  "feature",
  "bug",
  "chore",
  "refactor",
  "docs",
  "test",
  "security",
]);
export const actorType = pgEnum("actor_type", ["user", "agent", "system"]);
export const agentRole = pgEnum("agent_role", ["developer", "reviewer", "analyzer"]);
export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const reviewVerdict = pgEnum("review_verdict", ["approve", "request_changes", "comment"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const users = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("owner"),
  ...timestamps,
});

export type ProjectSettings = {
  mergeMethod: "merge" | "squash" | "rebase";
  autoDispatch: boolean;
  maxParallelRuns: number;
  maxProposalsPerRun: number;
};

export const projects = pgTable("project", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  key: text("key").notNull().unique(),
  description: text("description"),
  githubOwner: text("github_owner"),
  githubRepo: text("github_repo"),
  defaultBranch: text("default_branch").notNull().default("main"),
  githubInstallationId: bigint("github_installation_id", { mode: "number" }),
  vercelProjectId: text("vercel_project_id"),
  productionUrl: text("production_url"),
  nextTaskNumber: integer("next_task_number").notNull().default(1),
  settings: jsonb("settings")
    .$type<ProjectSettings>()
    .notNull()
    .default({ mergeMethod: "merge", autoDispatch: true, maxParallelRuns: 1, maxProposalsPerRun: 5 }),
  ...timestamps,
});

export const tasks = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    acceptanceCriteria: text("acceptance_criteria").notNull().default(""),
    type: taskType("type").notNull().default("feature"),
    priority: taskPriority("priority").notNull().default("medium"),
    status: taskStatus("status").notNull().default("todo"),
    labels: text("labels").array().notNull().default([]),
    source: actorType("source").notNull().default("user"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdByAgent: text("created_by_agent"),
    assignee: text("assignee"),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id),
    createdByRunId: uuid("created_by_run_id").references((): AnyPgColumn => agentRuns.id, {
      onDelete: "set null",
    }),
    branchName: text("branch_name"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    prHeadSha: text("pr_head_sha"),
    mergeCommitSha: text("merge_commit_sha"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    previewUrl: text("preview_url"),
    productionDeployedAt: timestamp("production_deployed_at", { withTimezone: true }),
    checksStatus: text("checks_status"),
    onHold: boolean("on_hold").notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("task_project_number_idx").on(t.projectId, t.number),
    index("task_project_status_idx").on(t.projectId, t.status),
  ],
);

export const agentRuns = pgTable("agent_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  role: agentRole("role").notNull(),
  agent: text("agent").notNull(),
  apiTokenId: uuid("api_token_id").references((): AnyPgColumn => apiTokens.id, { onDelete: "set null" }),
  status: runStatus("status").notNull().default("queued"),
  githubRunId: bigint("github_run_id", { mode: "number" }),
  githubRunUrl: text("github_run_url"),
  summary: text("summary"),
  cancelledBy: text("cancelled_by"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps,
});

export type ReviewFinding = {
  severity: "critical" | "major" | "minor" | "nit";
  file?: string;
  line?: number;
  message: string;
};

export const reviews = pgTable("review", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  prNumber: integer("pr_number"),
  reviewer: text("reviewer").notNull(),
  verdict: reviewVerdict("verdict").notNull(),
  body: text("body").notNull().default(""),
  findings: jsonb("findings").$type<ReviewFinding[]>().notNull().default([]),
  ...timestamps,
});

export const comments = pgTable("comment", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  authorType: actorType("author_type").notNull(),
  author: text("author").notNull(),
  body: text("body").notNull(),
  ...timestamps,
});

export const taskEvents = pgTable(
  "task_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actorType: actorType("actor_type").notNull(),
    actor: text("actor").notNull(),
    type: text("type").notNull(),
    from: text("from"),
    to: text("to"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("task_event_task_idx").on(t.taskId, t.createdAt)],
);

// Single-row table (id = 1) for global settings such as the agents switch.
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  agentsEnabled: boolean("agents_enabled").notNull().default(true),
  agentsPausedAt: timestamp("agents_paused_at", { withTimezone: true }),
  agentsPausedBy: text("agents_paused_by"),
  ...timestamps,
});

export const apiTokens = pgTable("api_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: text("scopes").array().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
});

export const webhookDeliveries = pgTable("webhook_delivery", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});
