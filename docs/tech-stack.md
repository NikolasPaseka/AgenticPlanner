# Tech stack

Constraints: must deploy on Vercel. Team experience: Next.js, React, Node,
MongoDB, PostgreSQL.

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js (App Router) + TypeScript** | Native on Vercel. Server actions and route handlers cover UI and API in one app. |
| UI | **Tailwind CSS + shadcn/ui**, **dnd-kit** for the board | Fast to build, accessible components, drag-and-drop kanban. |
| Database | **PostgreSQL on Neon** (Vercel Marketplace) | Relational data, transactional status changes, a database branch per preview deploy. |
| ORM and migrations | **Drizzle ORM** + drizzle-kit | Typed SQL, light runtime, works well on serverless. |
| Human auth | **Auth.js with GitHub OAuth** | The owner's GitHub identity already owns the repos. |
| Agent auth | Per-project API tokens, stored hashed | Simple, scoped, revocable. |
| Git integration | **GitHub App** + Octokit | Fine-grained repo permissions, webhooks, merge API, short-lived installation tokens. |
| Agent runtime | **GitHub Actions running Claude Code** (claude-code-action or Agent SDK) | Long jobs, full checkout, tests, no Vercel time limits. |
| Agent to app | **MCP server** at `/api/mcp`, plus REST | Agents call tools like `claim_task` and `submit_for_review`. |
| Realtime | Polling with TanStack Query first, SSE later | Enough for one user, no extra service. |
| Background work | Webhook handlers + Vercel Cron; Inngest if it grows | No extra infrastructure in v1. |
| Validation | Zod | One schema for forms, REST, and MCP tools. |
| Testing | Vitest, Playwright | Unit and end-to-end. |
| Hosting | Vercel: preview per PR, production on `main` | The same pipeline the app manages for other projects. |

## PostgreSQL vs MongoDB

PostgreSQL is recommended:

- The data is relational: project, tasks, agent runs, reviews, events.
- Status transitions must be atomic. A task must be claimed exactly once, and
  the audit event must be written in the same transaction.
- Neon branches give each Vercel preview its own database, so agent PRs that
  change the schema can be tested safely.

MongoDB Atlas also works on Vercel. If you prefer it, the model in
[data-model.md](data-model.md) maps to collections with little change, and
atomic claims can use `findOneAndUpdate` with a status filter.

## Why agents run in GitHub Actions, not on Vercel

Vercel functions have execution time limits and no persistent filesystem. An
agent implementing a feature needs a full checkout, dependency installs, test
runs, and minutes to an hour of runtime. GitHub Actions provides all of that,
already has repo credentials, and its PRs trigger Vercel previews for free.

Alternatives to evaluate later: Vercel Sandbox, Claude Code on the web with
routines, or a worker on Fly.io or Railway.

## Decisions (2026-11-17)

| Question | Decision |
|----------|----------|
| Database | PostgreSQL on Neon |
| Agent runtime | GitHub Actions running Claude Code |
| Merge method | Merge commit |
| Dispatch | Automatic: agents pick up `todo` tasks by priority, within the project's parallel run limit |
| Agent-created tasks | Start as `proposed` and need owner approval |
| Users | Single owner for now |
