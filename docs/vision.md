# Vision

## Problem

AI coding agents can analyze, implement, and review code, but their work is
scattered across chat sessions, terminals, and PRs. There is no single place
where a human sees what agents are doing, what they found, and what waits for
approval.

## Product

AgentPlanner is an extended todo list per software project, shared by a human
owner and several AI agents.

- **Projects** map to one GitHub repository and one Vercel project.
- **Tasks** have a name, description, acceptance criteria, priority, type,
  labels, and a status that moves across a board.
- **Agents** pick up tasks, work on a branch, open a PR, and move the task to
  review. Analyzer and reviewer agents create new tasks for problems they find.
- **The human** creates tasks, prioritizes, and approves or rejects changes.
  Approving merges the PR; Vercel deploys `main` automatically.

## Actors

| Actor | Can do |
|-------|--------|
| Owner (human) | Everything. The only actor allowed to approve and merge. |
| Developer agent | Read tasks, claim a task, report progress, link branch and PR. |
| Reviewer agent | Read PRs, post review findings, request changes, create tasks. |
| Analyzer agent | Scan the repo or production, create tasks as proposals. |

## Principles

1. **Human in the loop for anything that ships.** Agents never merge.
2. **Everything is traceable.** Each task shows who created it, every status
   change, the branch, PR, preview URL, checks, and review findings.
3. **Agent-created tasks are proposals** until the owner accepts them, so
   agents cannot flood the backlog.
4. **Vercel-native.** The app runs on Vercel; long-running agent work runs
   outside Vercel functions.

## In scope (v1)

- Single owner, multiple projects, GitHub and Vercel integration.
- Kanban board and list view, task detail with an activity timeline.
- Review queue with PR link, preview deployment, CI checks, agent findings.
- Approve (merge) and request changes from inside the app.
- Agent access through an MCP server and a REST API with project tokens.

## Out of scope (v1)

- Teams, roles beyond owner, billing.
- Non-GitHub hosts (GitLab, Bitbucket) and non-Vercel deploy targets.
- Running agents inside the app's own serverless functions.
