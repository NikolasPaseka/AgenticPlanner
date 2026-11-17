# Data model

PostgreSQL through Drizzle. Every table has `id` (uuid), `created_at`, and
`updated_at`.

## Entities

### user
`github_id`, `login`, `name`, `avatar_url`, `role` (`owner`).

### project
| Field | Notes |
|-------|-------|
| `name`, `slug`, `description` | |
| `key` | Short prefix for task keys, e.g. `AP` gives `AP-42` |
| `github_owner`, `github_repo`, `default_branch` | Default branch usually `main` |
| `github_installation_id` | GitHub App installation |
| `vercel_project_id`, `production_url` | |
| `settings` (jsonb) | Merge method, auto-dispatch, proposal policy, max parallel agents |

### task
| Field | Notes |
|-------|-------|
| `project_id`, `number` | `number` is per project, displayed as `KEY-number` |
| `title`, `description` | Description is markdown |
| `acceptance_criteria` | Markdown. What "done" means; agents work against it |
| `type` | `feature`, `bug`, `chore`, `refactor`, `docs`, `test`, `security` |
| `priority` | `urgent`, `high`, `medium`, `low` |
| `status` | See the state machine below |
| `labels` | text[] |
| `source` | `human` or `agent` |
| `created_by_user_id`, `created_by_agent` | Who created it |
| `assignee` | `null`, `owner`, or an agent role |
| `parent_task_id` | Links follow-ups found during review |
| `on_hold` | Boolean. When true, the auto-dispatcher skips the task and agents cannot claim it |
| `branch_name`, `pr_number`, `pr_url` | Set when work starts and the PR opens |
| `preview_url`, `checks_status` | Filled from webhooks |
| `position` | Manual ordering within a group (after priority) |

### agent_run
One execution of an agent on a task.
`task_id`, `role` (`developer`, `reviewer`, `analyzer`), `status` (`queued`,
`running`, `succeeded`, `failed`, `cancelled`), `github_run_id`,
`github_run_url`, `summary`, `cost_usd`, `started_at`, `finished_at`,
`cancelled_by` (set when the owner stops the run).

### review
`task_id`, `pr_number`, `reviewer` (agent role or user), `verdict`
(`approve`, `request_changes`, `comment`), `body`, `findings` (jsonb list of
severity, file, line, message).

### comment
`task_id`, `author_type` (`user` or `agent`), `author`, `body`.

### task_event
Append-only audit log. `task_id`, `actor_type`, `actor`, `type` (`created`,
`status_changed`, `pr_linked`, `checks_updated`, `deployed`, ...), `from`,
`to`, `payload` (jsonb).

### app_settings
A single row of global settings. `agents_enabled` (boolean) is the global
agents switch. `agents_paused_at` and `agents_paused_by` record who turned it
off and when.

### api_token
`project_id`, `name`, `token_hash`, `scopes` (text[]), `last_used_at`,
`revoked_at`.

## Task state machine

```
 proposed --accept--> todo --claim--> in_progress --submit--> in_review
    |                  ^                 |    ^                 |    |
  reject               |              block  unblock            |    |
    v                  |                 v    |                 |    |
 cancelled           reopen            blocked                  |    |
                       |                                        |    |
               changes_requested <-------request changes--------+    |
                       |                                          approve
                       +--re-dispatch--> in_progress                 v
                                                done <--deployed-- merged
```

| Status | Meaning | Who moves it here |
|--------|---------|-------------------|
| `proposed` | Created by an agent, waiting for owner triage | agent |
| `backlog` | Accepted but not planned yet (optional column) | owner |
| `todo` | Ready to be worked on | owner |
| `in_progress` | An agent or the owner is working on it | agent, owner |
| `blocked` | Needs input; reason stored in the event payload | agent, owner |
| `in_review` | PR open, waiting for review and approval | agent |
| `changes_requested` | Owner or reviewer asked for changes | owner, reviewer agent |
| `merged` | PR merged into `main` | system, on approve |
| `done` | Production deploy succeeded | system, on Vercel webhook |
| `cancelled` | Will not be done | owner |

Rules:

- All transitions live in one module (`lib/domain/tasks.ts`). Each one writes
  a `task_event` in the same transaction.
- Claiming uses `UPDATE task SET status = 'in_progress' WHERE id = $1 AND
  status = 'todo'`, so two agents cannot take the same task.
- Only the owner can move a task to `merged` or `cancelled`, or accept a
  `proposed` task.
