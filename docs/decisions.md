# Decision log

Record architecture decisions here, newest first. Status is `proposed`,
`accepted`, or `superseded`.

| # | Date | Decision | Status |
|---|------|----------|--------|
| 21 | 2026-11-22 | Light, dark, or system theme per browser, stored in localStorage and applied by an inline script before the first paint | accepted |
| 20 | 2026-11-22 | The change browser reads PR files and commits from GitHub on demand through the App; diffs are not stored | accepted |
| 19 | 2026-11-22 | Project pages are tabs by stage (Planned, In progress, Review, Done, Runs, Settings); new tasks and projects are created in dialogs | accepted |
| 18 | 2026-11-17 | Deployment status comes from GitHub `deployment_status` events sent by Vercel's GitHub integration, not Vercel webhooks | accepted |
| 17 | 2026-11-17 | Failed or stopped runs put the task on hold instead of retrying; agent review loops stop after 3 rounds | accepted |
| 16 | 2026-11-17 | Dispatch is event-driven (after() on changes and webhooks) with Vercel Cron as a safety net, under a per-project advisory lock | accepted |
| 15 | 2026-11-17 | Merges pass the reviewed head SHA; a PR merged on GitHub only counts as approval if an owner merged it | accepted |
| 14 | 2026-11-17 | GitHub access goes through a small gateway interface; tests use a fake GitHub API server | accepted |
| 13 | 2026-11-17 | Local first: embedded Postgres (PGlite) for local dev and tests, a development-only login, and Playwright end-to-end tests per milestone | accepted |
| 12 | 2026-11-17 | UI uses small hand-written Tailwind components; add shadcn/ui only if components grow complex | accepted |
| 11 | 2026-11-17 | Neon WebSocket pool (not HTTP) so services can use interactive transactions; node-postgres for localhost | accepted |
| 10 | 2026-11-17 | Tasks are shown as a vertical list grouped by status, priority, or type instead of a kanban board | accepted |
| 9 | 2026-11-17 | Owner controls: global agents switch, Stop (cancels the Actions run, keeps the branch, puts the task on hold), per-task hold | accepted |
| 8 | 2026-11-17 | Single owner; no teams or roles in v1 | accepted |
| 7 | 2026-11-17 | Auto-dispatch: `todo` tasks are picked up automatically by priority, limited by max parallel runs (default 1); merge method is merge commit | accepted |
| 6 | 2026-11-17 | Agent-created tasks start as `proposed` and need owner triage | accepted |
| 5 | 2026-11-17 | Only the owner can merge; the app merges via the GitHub App after approval | accepted |
| 4 | 2026-11-17 | Agents run in GitHub Actions with Claude Code, not in Vercel functions | accepted |
| 3 | 2026-11-17 | Agents talk to the app through an MCP server plus REST, with project tokens | accepted |
| 2 | 2026-11-17 | PostgreSQL on Neon with Drizzle ORM  | accepted |
| 1 | 2026-11-17 | Next.js App Router + TypeScript on Vercel, Tailwind + shadcn/ui | superseded by 12 |

## Template

```
### N. Title
Date:
Status:
Context: what forces the decision
Decision: what we chose
Consequences: what gets easier, what gets harder
```
