# AgentPlanner

A project and task board built for **agentic software development**.
Humans and AI agents share one backlog: agents analyze, implement, and review;
the human enters tasks and approves changes. Approval merges the pull request
into `main`, and Vercel deploys it to production.

> Status: **M0 foundations**. Stack decided (see [docs/tech-stack.md](docs/tech-stack.md)).

## Core idea

```
 you --create task--> Todo --assign--> Agent works on branch --PR--> In Review
                                                                       |
            agents create follow-up tasks <-- reviewer agent <---------+
                                                                       v
                       Vercel production <-- merge to main <-- you approve
```

## Documentation

| Doc | What it covers |
|-----|----------------|
| [docs/vision.md](docs/vision.md) | Goals, users, scope, non-goals |
| [docs/tech-stack.md](docs/tech-stack.md) | Proposed stack, alternatives, open questions |
| [docs/architecture.md](docs/architecture.md) | Components, deployment, request flows |
| [docs/data-model.md](docs/data-model.md) | Entities, fields, task state machine |
| [docs/agent-workflow.md](docs/agent-workflow.md) | Agent roles, lifecycle, Git and Vercel pipeline |
| [docs/api.md](docs/api.md) | REST API, MCP tools for agents, webhooks |
| [docs/security.md](docs/security.md) | Auth, tokens, permissions, guardrails |
| [docs/roadmap.md](docs/roadmap.md) | Milestones from MVP to full automation |
| [docs/decisions.md](docs/decisions.md) | Architecture decision log |

Instructions for AI agents working on this repo are in [CLAUDE.md](CLAUDE.md).

## Development

Requires Node 24 and a Neon Postgres database.

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL
npm run db:migrate           # apply migrations in drizzle/
npm run dev                  # http://localhost:3000
```

| Script | Purpose |
|--------|---------|
| `npm run lint` / `typecheck` / `test` | Checks that CI runs on every PR |
| `npm run db:generate` | Create a migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:studio` | Browse the database |

## Deployment

1. Import the GitHub repo in Vercel (framework: Next.js).
2. Add Neon from the Vercel Marketplace; it sets `DATABASE_URL` for production and previews.
3. Every PR gets a preview deployment; merges to `main` deploy production.
