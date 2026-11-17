# Roadmap

Each milestone is tested locally first (see [testing.md](testing.md)), then
merged and deployed to Vercel.

## M0: Foundations (done)
- Confirm the stack (see [tech-stack.md](tech-stack.md) open questions).
- Scaffold Next.js, Tailwind, Drizzle, Neon, Auth.js.
- Create the GitHub repo and Vercel project; preview and production deploys work.
- CI: lint, typecheck, unit tests on every PR.

## M1: Manual task board (built, testing locally)
- Projects CRUD with task key prefix.
- Tasks CRUD: title, description, acceptance criteria, priority, type, labels.
- Vertical task list grouped by status (or priority or type), with search and filters.
- Task detail with comments and activity timeline.
- State machine module with tests.
- Global agents switch and per-task hold in the UI.
- Local development login, embedded Postgres, and Playwright end-to-end tests.

## M2: Agent API (built, testing locally)
- API tokens per project (create, revoke, scopes).
- REST v1 and the MCP server with the tools in [api.md](api.md).
- Proposed tasks inbox for agent-created tasks.
- Manual test: Claude Code on a laptop drives tasks through MCP.

## M3: GitHub integration (built, testing locally)
- GitHub App: install flow, link project to repo.
- Webhooks: link PRs to tasks, show CI status.
- Review queue page: PR, checks, findings, approve, request changes, reject.
- Approve merges through the API; reject closes the PR.

## M4: Automated agents (built, testing locally)
- Workflow templates for developer, reviewer, analyzer.
- Auto-dispatcher (event-driven plus Vercel Cron) starts the developer workflow for the top `todo` task; manual dispatch and pause per project; agent runs page.
- Owner controls: global agents switch in the header, Stop button that cancels a running GitHub Actions run, and an "on hold" flag per task.
- Request changes re-dispatches the developer with feedback.
- Reviewer runs automatically on agent PRs.

## M5: Vercel and polish
- Vercel webhooks: preview URL on tasks, `done` on production deploy.
- Auto-dispatch option, parallel run limits, cost tracking.
- Notifications (email or push) for blocked tasks and review requests.
- Dogfooding: AgentPlanner manages its own repo.
