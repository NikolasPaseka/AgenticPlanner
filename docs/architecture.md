# Architecture

## Components

```
                      +-------------------------------------------+
 Owner (browser) ---> | AgentPlanner (Next.js on Vercel)          |
                      |  - UI: task list, task detail, review    |
                      |  - REST API      /api/v1/*                |
                      |  - MCP server    /api/mcp                 |
                      |  - Webhooks      /api/webhooks/github     |
                      |                  /api/webhooks/vercel     |
                      +----------+------------------+-------------+
                                 |                  |
                         Postgres (Neon)     GitHub App (Octokit)
                                                    |
        +-------------------------------------------+---------------------+
        v                                           v                     v
 GitHub Actions agent jobs                  Target repository       Vercel project
 (Claude Code: developer,                   branches, PRs, checks   preview per PR,
  reviewer, analyzer) --MCP--> app                                  production on main
```

AgentPlanner can register its own repository as a project, so agents can
improve the planner through the same flow.

## Main flows

### 1. Owner creates a task
UI form, server action, insert `task` with status `todo`, write a
`task_event`.

### 2. Dispatch to a developer agent
1. If the global agents switch is off, nothing is dispatched. Otherwise the
   dispatcher skips tasks on hold and picks the highest-priority `todo` task when the project is
   under its parallel run limit. It runs on task changes, on run completion,
   and on a Vercel Cron every few minutes as a safety net.
2. App atomically moves the task to `in_progress` and creates an `agent_run`
   with status `queued`.
3. App calls GitHub `workflow_dispatch` on the target repo's
   `agentplanner-develop.yml`, passing `task_id` and `run_id`.

### Stopping a run
The owner clicks **Stop**. The app calls GitHub's cancel workflow run API for
`agent_run.github_run_id`, marks the run `cancelled`, moves the task to
`todo` or `blocked`, sets `on_hold`, and writes a `task_event`. The branch is
kept. The `workflow_run` webhook confirms the cancellation.

### 3. Agent works
1. The workflow checks out the repo and runs Claude Code with the
   AgentPlanner MCP server configured.
2. The agent calls `get_task`, creates branch `agent/<KEY-n>-<slug>`,
   implements, runs tests, pushes, and opens a PR whose body references the
   task key.
3. The agent calls `submit_for_review` with the PR number and a summary.

### 4. Pipeline feedback
- GitHub `pull_request` webhook links or confirms the PR on the task.
- `check_suite` and `check_run` webhooks update CI status.
- GitHub `deployment_status` (or Vercel `deployment.succeeded`) attaches the
  preview URL.
- A reviewer agent workflow runs on the PR, records findings through MCP, and
  may create follow-up tasks as proposals.

### 5. Owner decides
- **Approve:** app merges the PR through the GitHub API, task becomes
  `merged`. The Vercel production deploy webhook then moves it to `done` with
  the production URL.
- **Request changes:** app posts a PR review comment, task becomes
  `changes_requested`, and the developer agent is re-dispatched with the
  feedback.
- **Reject:** app closes the PR, task becomes `cancelled` or returns to
  `todo`.

## Planned code layout

```
app/
src/app/
  (app)/page.tsx                                  projects
  (app)/projects/[slug]/page.tsx                  grouped task list
  (app)/projects/[slug]/tasks/[number]/page.tsx   task detail
  (app)/projects/[slug]/settings/page.tsx         project settings
  (app)/projects/[slug]/review/                   review queue (M3)
  actions.ts                                      server actions (owner-checked)
  signin/
  api/v1/...                REST for agents and integrations
  api/mcp/route.ts          MCP server (Streamable HTTP)
  api/webhooks/github/      GitHub App webhook receiver
  api/webhooks/vercel/      Vercel webhook receiver
lib/
  db/schema.ts              Drizzle schema
  domain/tasks.ts           state machine, transitions, events
  github/                   App auth, dispatch, merge
  vercel/                   deployment lookups
  mcp/tools.ts              MCP tool definitions (Zod)
templates/workflows/        GitHub Actions installed into target repos
docs/
```

## Deployment

- One Vercel project for AgentPlanner, Neon added from the Vercel Marketplace.
- Environment variables:
  `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`,
  `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`,
  `VERCEL_API_TOKEN`, `VERCEL_WEBHOOK_SECRET`.
- Each target repo needs the GitHub App installed, the workflow templates
  committed, and `ANTHROPIC_API_KEY` and `AGENTPLANNER_TOKEN` as Actions
  secrets. Its Vercel project must be connected to the repo with production
  branch `main`.
