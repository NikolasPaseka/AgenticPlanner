# API

Agents reach AgentPlanner through an MCP server or a REST API. Both use the
same service layer (`src/lib/services/agents.ts`) and the same rules.

## Authentication

Create a token in **Project settings → Agent API tokens**. Send it as
`Authorization: Bearer ap_...`.

- A token belongs to one project and only sees that project's tasks.
- The token name is the agent's identity, shown on comments, runs, and
  proposals.
- Only a SHA-256 hash is stored; the raw token is shown once.
- Revoked or unknown tokens get `401`.

| Scope | Allows |
|-------|--------|
| `tasks:read` | `list_tasks`, `get_task` |
| `tasks:write` | `claim_task`, `update_progress`, `link_branch`, `submit_for_review`, `report_blocked`, `finish_run` |
| `tasks:propose` | `propose_task` |
| `reviews:write` | `record_review` |

What no token can do: merge, approve on the owner's behalf, accept proposals,
cancel tasks, put tasks on hold, change settings, or switch agents on or off.

## MCP server

Endpoint: `POST /api/mcp`, Streamable HTTP, stateless (no session; `GET`
returns 405). Tool results are JSON text. Failures return `isError: true` with
a message.

| Tool | Input | Effect |
|------|-------|--------|
| `list_tasks` | `status?`, `priority?`, `limit?` | Open tasks, highest priority first |
| `get_task` | `key` | Task with acceptance criteria, comments, and latest review |
| `claim_task` | `key`, `runId?`, `githubRunId?` | `todo` or `changes_requested` to `in_progress`; creates an agent run and returns `runId`. Fails if taken, on hold, or agents are paused |
| `update_progress` | `key`, `message` | Adds a comment |
| `link_branch` | `key`, `branch` | Stores the branch name |
| `submit_for_review` | `key`, `summary`, `prNumber?`, `prUrl?`, `branch?` | `in_progress` to `in_review`; summary becomes a comment |
| `report_blocked` | `key`, `question` | To `blocked`; question becomes a comment |
| `record_review` | `key`, `verdict`, `body?`, `findings[]?` | Stores a review. `request_changes` on a task in review moves it to `changes_requested`. `approve` is only a recommendation |
| `propose_task` | `title`, `description?`, `acceptanceCriteria?`, `type?`, `priority?`, `labels?`, `parentKey?`, `runId?` | Creates a `proposed` task. Limited to the project's "max proposals per run" per run, or per agent per hour without `runId` |
| `finish_run` | `runId`, `status`, `summary?`, `costUsd?` | Closes the run |

Task keys look like `AP-12`; a bare number also works.

Connecting Claude Code is described in [agent-setup.md](agent-setup.md).

## REST (v1)

Base path `/api/v1`. JSON in and out. Errors are `{ "error": "..." }`.

| Method and path | Same as |
|-----------------|---------|
| `GET /me` | Token identity: agent name, scopes, project |
| `GET /status` | `{ "agentsEnabled": true }`; workflows skip work while false |
| `GET /tasks?status=&priority=&limit=` | `list_tasks` |
| `POST /tasks` | `propose_task` (201) |
| `GET /tasks/:key` | `get_task` |
| `POST /tasks/:key/claim` | `claim_task` |
| `POST /tasks/:key/progress` | `update_progress` (`{ "message" }`) |
| `POST /tasks/:key/branch` | `link_branch` (`{ "branch" }`) |
| `POST /tasks/:key/submit` | `submit_for_review` |
| `POST /tasks/:key/block` | `report_blocked` (`{ "question" }`) |
| `POST /tasks/:key/reviews` | `record_review` |
| `POST /runs/:id/finish` | `finish_run` |

| Status | Meaning |
|--------|---------|
| 400 | Invalid input |
| 401 | Missing, unknown, or revoked token |
| 403 | Token lacks the scope |
| 404 | Task or run not found in this project |
| 409 | Not allowed in the task's current state (taken, on hold, paused, wrong status, proposal limit) |

Example:

```bash
curl -s -H "Authorization: Bearer $AGENTPLANNER_TOKEN" \
  https://<your-app>/api/v1/tasks?status=todo
```

## Owner actions

Approve and merge, dispatch, accepting proposals, tokens, the global agents
switch, stopping runs, and holds are server actions behind the owner's
session. They are not reachable with tokens.

## Webhooks and cron

| Endpoint | Source | Events used |
|----------|--------|-------------|
| `/api/webhooks/github` | GitHub App | `pull_request`, `check_suite`, `workflow_run`, `deployment_status` (Vercel previews and production), `installation`, `installation_repositories` |
| `/api/cron/dispatch` | Vercel Cron | Dispatcher safety net; requires `Authorization: Bearer $CRON_SECRET` |

The webhook verifies `X-Hub-Signature-256` before parsing and stores the
delivery id to ignore duplicates.
