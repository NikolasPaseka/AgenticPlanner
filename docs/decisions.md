# Decision log

Record architecture decisions here, newest first. Status is `proposed`,
`accepted`, or `superseded`.

| # | Date | Decision | Status |
|---|------|----------|--------|
| 9 | 2026-11-17 | Owner controls: global agents switch, Stop (cancels the Actions run, keeps the branch, puts the task on hold), per-task hold | accepted |
| 8 | 2026-11-17 | Single owner; no teams or roles in v1 | accepted |
| 7 | 2026-11-17 | Auto-dispatch: `todo` tasks are picked up automatically by priority, limited by max parallel runs (default 1); merge method is merge commit | accepted |
| 6 | 2026-11-17 | Agent-created tasks start as `proposed` and need owner triage | accepted |
| 5 | 2026-11-17 | Only the owner can merge; the app merges via the GitHub App after approval | accepted |
| 4 | 2026-11-17 | Agents run in GitHub Actions with Claude Code, not in Vercel functions | accepted |
| 3 | 2026-11-17 | Agents talk to the app through an MCP server plus REST, with project tokens | accepted |
| 2 | 2026-11-17 | PostgreSQL on Neon with Drizzle ORM  | accepted |
| 1 | 2026-11-17 | Next.js App Router + TypeScript on Vercel, Tailwind + shadcn/ui | accepted |

## Template

```
### N. Title
Date:
Status:
Context: what forces the decision
Decision: what we chose
Consequences: what gets easier, what gets harder
```
