import { authenticateAgent } from "@/lib/api/auth";
import { describeError } from "@/lib/api/errors";
import { scheduleDispatch } from "@/lib/dispatch-trigger";
import type { Db } from "@/lib/db";
import type { TaskStatus } from "@/lib/domain/tasks";
import { getAppSettings } from "@/lib/services/settings";
import {
  agentClaimTask,
  agentFinishRun,
  agentGetTask,
  agentLinkBranch,
  agentListTasks,
  agentProposeTask,
  agentRecordReview,
  agentReportBlocked,
  agentSubmitForReview,
  agentUpdateProgress,
  type AgentContext,
} from "@/lib/services/agents";

// REST API for agents and scripts. Same operations and permissions as the MCP server.
// See docs/api.md.

type Handler = (db: Db, ctx: AgentContext, args: { params: string[]; body: Record<string, unknown>; query: URLSearchParams }) => Promise<unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");

const routes: { method: string; pattern: string[]; handler: Handler }[] = [
  {
    method: "GET",
    pattern: ["me"],
    handler: async (_db, ctx) => ({
      agent: ctx.actor.name,
      scopes: ctx.token.scopes,
      project: { name: ctx.project.name, key: ctx.project.key, slug: ctx.project.slug },
    }),
  },
  {
    // Workflows call this first and skip their work while agents are paused.
    method: "GET",
    pattern: ["status"],
    handler: async (db) => ({ agentsEnabled: (await getAppSettings(db)).agentsEnabled }),
  },
  {
    method: "GET",
    pattern: ["tasks"],
    handler: (db, ctx, { query }) =>
      agentListTasks(db, ctx, {
        status: (query.get("status") as TaskStatus) || undefined,
        priority: query.get("priority") || undefined,
        limit: query.get("limit") ? Number(query.get("limit")) : undefined,
      }),
  },
  { method: "POST", pattern: ["tasks"], handler: (db, ctx, { body }) => agentProposeTask(db, ctx, body as never) },
  { method: "GET", pattern: ["tasks", ":key"], handler: (db, ctx, { params }) => agentGetTask(db, ctx, params[0]) },
  {
    method: "POST",
    pattern: ["tasks", ":key", "claim"],
    handler: (db, ctx, { params, body }) =>
      agentClaimTask(db, ctx, params[0], {
        runId: str(body.runId) || undefined,
        githubRunId: typeof body.githubRunId === "number" ? body.githubRunId : undefined,
      }),
  },
  {
    method: "POST",
    pattern: ["tasks", ":key", "progress"],
    handler: (db, ctx, { params, body }) => agentUpdateProgress(db, ctx, params[0], str(body.message)),
  },
  {
    method: "POST",
    pattern: ["tasks", ":key", "branch"],
    handler: (db, ctx, { params, body }) => agentLinkBranch(db, ctx, params[0], str(body.branch)),
  },
  {
    method: "POST",
    pattern: ["tasks", ":key", "submit"],
    handler: (db, ctx, { params, body }) => agentSubmitForReview(db, ctx, params[0], body as never),
  },
  {
    method: "POST",
    pattern: ["tasks", ":key", "block"],
    handler: (db, ctx, { params, body }) => agentReportBlocked(db, ctx, params[0], str(body.question)),
  },
  {
    method: "POST",
    pattern: ["tasks", ":key", "reviews"],
    handler: (db, ctx, { params, body }) => agentRecordReview(db, ctx, params[0], body as never),
  },
  {
    method: "POST",
    pattern: ["runs", ":id", "finish"],
    handler: (db, ctx, { params, body }) => agentFinishRun(db, ctx, params[0], body as never),
  },
];

function match(method: string, path: string[]) {
  for (const r of routes) {
    if (r.pattern.length !== path.length) continue;
    const params: string[] = [];
    const ok = r.pattern.every((seg, i) => {
      if (seg.startsWith(":")) {
        params.push(decodeURIComponent(path[i]));
        return true;
      }
      return seg === path[i];
    });
    if (ok) return r.method === method ? { handler: r.handler, params } : { wrongMethod: true as const };
  }
  return null;
}

async function handle(req: Request, { params }: RouteContext<"/api/v1/[...path]">): Promise<Response> {
  const { path } = await params;
  const found = match(req.method, path);
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  if ("wrongMethod" in found) return Response.json({ error: "Method not allowed" }, { status: 405 });

  const auth = await authenticateAgent(req);
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : {};
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error();
    } catch {
      return Response.json({ error: "Body must be a JSON object" }, { status: 400 });
    }
  }

  try {
    const result = await found.handler(auth.db, auth.ctx, {
      params: found.params,
      body,
      query: new URL(req.url).searchParams,
    });
    if (req.method === "POST") scheduleDispatch();
    return Response.json(result, { status: req.method === "POST" && path.length === 1 ? 201 : 200 });
  } catch (e) {
    const { status, message } = describeError(e);
    return Response.json({ error: message }, { status });
  }
}

export const GET = handle;
export const POST = handle;
