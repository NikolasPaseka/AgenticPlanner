# API

Two interfaces share one domain layer: a REST API and an MCP server. Both
authenticate agents with a project API token sent as
`Authorization: Bearer <token>`. The owner uses the UI with a session cookie.

## MCP tools (agents)

Endpoint: `POST /api/mcp` (Streamable HTTP transport).

| Tool | Input | Effect |
|------|-------|--------|
| `list_tasks` | `status?`, `priority?`, `limit?` | Tasks of the token's project |
| `get_task` | `key` | Task with description, acceptance criteria, comments, latest review |
| `claim_task` | `key`, `run_id` | `todo` or `changes_requested` to `in_progress`; fails if taken, on hold, or agents are switched off |
| `start_run` | `run_id`, `github_run_url` | Marks an `agent_run` as running |
| `update_progress` | `key`, `message` | Adds an agent comment |
| `link_branch` | `key`, `branch` | Stores the branch name |
| `submit_for_review` | `key`, `pr_number`, `summary` | Links PR, status to `in_review` |
| `report_blocked` | `key`, `question` | Status to `blocked`, notifies owner |
| `record_review` | `key`, `verdict`, `body`, `findings[]` | Stores a review; `request_changes` moves status |
| `propose_task` | `title`, `description`, `type`, `priority`, `parent_key?` | Creates a `proposed` task |
| `finish_run` | `run_id`, `status`, `summary`, `cost_usd?` | Closes the `agent_run` |

Example Claude Code MCP config in a target repo (`.mcp.json`):

```json
{
  "mcpServers": {
    "agentplanner": {
      "type": "http",
      "url": "https://<your-app>.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer ${AGENTPLANNER_TOKEN}" }
    }
  }
}
```

## REST (v1)

| Method and path | Purpose |
|-----------------|---------|
| `GET /api/v1/projects/:slug/tasks` | List tasks, filter by status, priority, label |
| `POST /api/v1/projects/:slug/tasks` | Create a task (agents create `proposed`) |
| `GET /api/v1/tasks/:key` | Task detail |
| `PATCH /api/v1/tasks/:key` | Update fields allowed for the caller |
| `POST /api/v1/tasks/:key/transitions` | `{ "to": "in_review", ... }` validated by the state machine |
| `POST /api/v1/tasks/:key/comments` | Add a comment |
| `POST /api/v1/tasks/:key/reviews` | Record a review |
| `POST /api/v1/runs/:id` | Update an agent run |

Owner-only actions (approve and merge, dispatch, accept proposals, manage
tokens, the global agents switch, stopping runs, putting tasks on hold) are server actions behind the session, not exposed to tokens.

## Webhooks (inbound)

| Endpoint | Source | Events used |
|----------|--------|-------------|
| `/api/webhooks/github` | GitHub App | `pull_request`, `pull_request_review`, `check_suite`, `check_run`, `workflow_run`, `deployment_status`, `installation` |
| `/api/webhooks/vercel` | Vercel | `deployment.created`, `deployment.succeeded`, `deployment.error` |

Both verify the signature header (`X-Hub-Signature-256`,
`x-vercel-signature`) before parsing, and store the delivery id to ignore
duplicates.
