# Agent workflows (GitHub Actions)

AgentPlanner starts agents as GitHub Actions runs in the target repository.
The templates are in [templates/workflows/](../templates/workflows/).

| Workflow | Trigger | Agent | Token scopes |
|----------|---------|-------|--------------|
| `agentplanner-develop.yml` | AgentPlanner dispatcher (`workflow_dispatch`) | Developer: implements one task, opens a PR, submits for review | `tasks:read`, `tasks:write`, `tasks:propose` |
| `agentplanner-review.yml` | PRs from `agent/*` branches | Reviewer: records a review with findings | `tasks:read`, `reviews:write`, `tasks:propose` |
| `agentplanner-analyze.yml` | Weekly, or by hand | Analyzer: proposes up to 5 tasks | `tasks:read`, `tasks:propose` |

All three check `GET /api/v1/status` first and do nothing while the global
agents switch is off.

## Setup in a target repository

1. Copy the three files into `.github/workflows/` and commit them to `main`.
   Adjust the Node setup steps in the develop workflow if the project uses
   another language.
2. In AgentPlanner, create three tokens in Project settings: `gha-dev`,
   `gha-review`, `gha-analyze` with the scopes above.
3. In the repository, Settings → Secrets and variables → Actions:

   | Kind | Name | Value |
   |------|------|-------|
   | Variable | `AGENTPLANNER_URL` | `https://<your-app>` (no trailing slash) |
   | Variable | `AGENTPLANNER_APP_ID` | The GitHub App ID |
   | Secret | `AGENTPLANNER_APP_PRIVATE_KEY` | The GitHub App private key |
   | Secret | `AGENTPLANNER_TOKEN` | `gha-dev` token |
   | Secret | `AGENTPLANNER_REVIEW_TOKEN` | `gha-review` token |
   | Secret | `AGENTPLANNER_ANALYZE_TOKEN` | `gha-analyze` token |
   | Secret | `ANTHROPIC_API_KEY` | Anthropic API key (or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, and change the workflows to use it) |

4. No extra Actions permissions are needed: the develop workflow pushes and
   opens PRs with the GitHub App token, not the default `GITHUB_TOKEN`.

Why the App token: pull requests opened with the default `GITHUB_TOKEN` do not
trigger other workflows, so CI and the reviewer would never run on agent PRs.

## How dispatching works

A task is started automatically when all of these hold:

1. The global agents switch is on.
2. The project's auto-dispatch is on and its repository is connected.
3. Fewer runs are queued or running than the project's parallel limit.
4. The task is Todo (or Changes requested) and not on hold.

Highest priority goes first, then the oldest task.

The dispatcher runs right after anything that can start work: creating or
moving a task, releasing a hold, switching agents on, saving settings, an
agent finishing or submitting, and GitHub webhooks. A Vercel Cron call to
`/api/cron/dispatch` is a safety net. Vercel Hobby allows one cron run per
day; on Pro, change `vercel.json` to every few minutes. Set `CRON_SECRET` in
Vercel so only Vercel can call it.

For each start, the dispatcher creates an agent run, moves the task to In
progress, and calls `workflow_dispatch` with `task_key` and `run_id`. The
workflow's run name contains the run id, so the `workflow_run` webhook links
the GitHub run to it.

## Stopping and failures

| Situation | What happens |
|-----------|--------------|
| You click **Stop** | The Actions run is cancelled, the run is marked stopped, the task goes to Todo or Blocked and is put on hold. The branch stays. If the agent still calls `claim_task`, it is refused. |
| The workflow cannot be dispatched (not installed, wrong name) | The run fails, the task returns to Todo on hold, and the timeline says why. |
| The run ends without the task reaching review | The task returns to Todo on hold. Release the hold to retry. |
| Developer and reviewer agents disagree | After 3 agent change requests, the task stays in review on hold for you. |
| Agents are switched off mid-run | Running jobs continue; use Stop to end them. New runs do not start. |

Holding tasks after a failure prevents an endless retry loop that would burn
Actions minutes and API credits.

## Costs

Each run uses GitHub Actions minutes and Claude API usage. Keep the parallel
limit at 1 at first, and use `--max-turns` in the workflows to cap long runs.
Agents can report cost with `finish_run`; it is shown on the runs page.
