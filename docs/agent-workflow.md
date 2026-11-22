# Agent workflow and pipeline

## Agent roles

| Role | Trigger | Does | Never does |
|------|---------|------|------------|
| Developer | `workflow_dispatch` from the app | Implements one task on a branch, opens a PR, submits for review | Merge, push to `main`, edit other tasks |
| Reviewer | PR opened or updated by an agent | Reviews the diff against acceptance criteria, records findings, requests changes or recommends approval, proposes follow-up tasks | Merge, approve on behalf of the owner |
| Analyzer | Schedule or manual run | Scans code, dependencies, tests, or production for issues; proposes tasks | Change code |

Each role is a GitHub Actions workflow template in `templates/workflows/`,
installed into the target repo. Each runs Claude Code with a role prompt and
the AgentPlanner MCP server.

## Lifecycle of a task

1. **Create.** The owner creates a task with title, description, acceptance
   criteria, priority, and type. Or an agent proposes one and the owner
   accepts it.
2. **Dispatch.** Automatic. When a task enters `todo`, a run finishes, or the
   dispatcher cron fires, the app picks the highest-priority `todo` task (then
   oldest), as long as the project is under its parallel run limit (default 1).
   It claims the task, creates an `agent_run`, and triggers
   `agentplanner-develop.yml`. The owner can pause auto-dispatch per project
   and can still dispatch a single task by hand.
3. **Implement.** The developer agent:
   - calls `start_run` and `get_task`;
   - creates branch `agent/AP-42-short-slug` from `main`;
   - implements, runs lint and tests, commits with `AP-42` in messages;
   - opens a PR titled `AP-42: <task title>` with a summary and test notes;
   - calls `submit_for_review(task, pr_number, summary)`.
   If stuck, it calls `report_blocked` with a question for the owner.
4. **Preview.** Vercel builds a preview for the PR. The webhook attaches the
   preview URL to the task.
5. **Review.** The reviewer agent runs on the PR, records a `review` with
   findings, and proposes follow-up tasks for out-of-scope issues.
6. **Approve.** The owner opens the Review tab, then the task's change
   browser: the PR diff with reviewer findings on their lines, commits,
   preview URL, and CI status. Then:
   - **Approve and merge:** the app merges with a merge commit and
     deletes the branch. Task becomes `merged`.
   - **Request changes:** the owner writes feedback. The app comments on the
     PR, sets `changes_requested`, and re-dispatches the developer agent on the
     same branch.
   - **Reject:** the PR is closed and the task is cancelled or reset.
7. **Deploy.** Vercel deploys `main` to production. The deployment webhook
   sets the task to `done` and stores the production URL.

## Git conventions

- Branch: `agent/<KEY-n>-<slug>` for agents, `<user>/<KEY-n>-<slug>` for humans.
- PR title: `<KEY-n>: <title>`. PR body contains `AgentPlanner: <KEY-n>` so
  webhooks can link it even if the agent fails to call the API.
- Merge method: merge commit by default, configurable per project.
- Branch protection on `main`: require PR, require passing checks, block
  direct pushes. The GitHub App is the only merge actor besides the owner.

## Vercel

- The target repo's Vercel project uses Git integration: every PR gets a
  preview, every push to `main` deploys production.
- AgentPlanner listens to deployment events to show preview and production
  status on tasks. It does not trigger deployments itself.

## Owner controls

You can start and stop agents at any time from the app.

| Control | Where | Effect |
|---------|-------|--------|
| **Global agents switch** | Toggle in the app header | Off: no new agent runs start in any project, including reviewer and analyzer runs. Runs already in progress keep going unless you stop them. On: dispatching resumes immediately. |
| **Project auto-dispatch** | Project settings | Off: agents stop picking up new tasks in this project. Manual dispatch still works while the global switch is on. |
| **Stop a run** | Stop button on the task and on the agent runs page | Cancels the GitHub Actions run through the GitHub API. The run becomes `cancelled`. A developer task goes back to `todo` (default) or `blocked`, which you choose in the stop dialog. The branch and any pushed commits stay, so a later run continues from them. Stopping also puts the task on hold, so it is not picked up again immediately. |
| **Hold a task** | "On hold" toggle on the task | The dispatcher skips the task while the rest of the project keeps running. `claim_task` refuses it. Manual dispatch clears the hold. |

A task is dispatched automatically only when all of these are true:

1. The global agents switch is on.
2. The project's auto-dispatch is on.
3. The project has fewer active runs than its parallel run limit.
4. The task is in `todo`, or in `changes_requested` with new feedback, and
   it is not on hold.

Details of dispatching, stopping, and failure handling: [agent-workflows.md](agent-workflows.md).

## Guardrails

- One active developer run per task. A max number of parallel runs per
  project, set in project settings.
- Agent runs have a timeout and a cost ceiling, recorded on `agent_run`.
- Agent-created tasks start as `proposed`. An analyzer has a per-run cap on
  how many tasks it can propose.
- Agents cannot change their own permissions, tokens, or workflow files
  without a human-approved PR.
