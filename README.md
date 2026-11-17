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
| [docs/testing.md](docs/testing.md) | Local development, test layers, per-milestone checklist |
| [docs/roadmap.md](docs/roadmap.md) | Milestones from MVP to full automation |
| [docs/decisions.md](docs/decisions.md) | Architecture decision log |

Instructions for AI agents working on this repo are in [CLAUDE.md](CLAUDE.md).

## Development

Requires Node 24. No cloud database is needed locally.

```bash
npm install
cp .env.example .env.local   # then fill in AUTH_SECRET and your login
npm run db:local             # terminal 1: embedded Postgres, migrations applied
npm run dev                  # terminal 2: http://localhost:3000
```

Click **Development login** on the sign-in page. Details and the per-milestone
test checklist are in [docs/testing.md](docs/testing.md).

| Script | Purpose |
|--------|---------|
| `npm test` | Unit and service tests (in-memory Postgres) |
| `npm run test:e2e` | End-to-end tests in Chrome against a throwaway database |
| `npm run lint` / `typecheck` / `build` | Static checks that CI also runs |
| `npm run db:local` | Embedded Postgres on localhost:5432 |
| `npm run db:generate` | Create a migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (e.g. Neon) |
| `npm run db:studio` | Browse the database |

## Deployment

1. Import the GitHub repo in Vercel (framework: Next.js).
2. Add Neon from the Vercel Marketplace; it sets `DATABASE_URL` for production and previews.
3. Run `npm run db:migrate` with the Neon `DATABASE_URL` to create the tables.
4. Set `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and
   `OWNER_GITHUB_LOGINS` in Vercel. The GitHub OAuth callback is
   `https://<your-domain>/api/auth/callback/github`.
5. Every PR gets a preview deployment; merges to `main` deploy production.
