# Connecting an agent

Any MCP client can work on AgentPlanner tasks. This guide uses Claude Code.

## 1. Create a token

Open **Project settings → Agent API tokens**, enter a name such as
`claude-dev`, keep the permissions you want, and click **Create token**. Copy
the token and the ready-made command; the token is not shown again.

Use separate tokens per role, for example `claude-dev` (developer) and
`claude-review` (reviewer with only `tasks:read` and `reviews:write`).

## 2. Add the MCP server to Claude Code

In the target repository:

```bash
claude mcp add --transport http agentplanner http://localhost:3000/api/mcp \
  --header "Authorization: Bearer ap_..."
```

Use your Vercel URL instead of `localhost:3000` for the deployed app. Check
the connection with `/mcp` inside Claude Code; the server lists 10 tools.

For a shared setup without the token in a file, commit `.mcp.json` and set
`AGENTPLANNER_TOKEN` in the environment:

```json
{
  "mcpServers": {
    "agentplanner": {
      "type": "http",
      "url": "https://<your-app>/api/mcp",
      "headers": { "Authorization": "Bearer ${AGENTPLANNER_TOKEN}" }
    }
  }
}
```

## 3. Ask Claude Code to work

Developer:

> Use the agentplanner tools. Pick the highest-priority todo task, claim it,
> create branch agent/<KEY>-<slug>, implement it against the acceptance
> criteria, run the tests, open a PR whose body contains
> "AgentPlanner: <KEY>", then submit_for_review with a summary and the PR
> number, and finish_run.

Reviewer:

> Use the agentplanner tools. For each task in review, read the PR diff and
> the acceptance criteria. record_review with request_changes and findings if
> something is wrong, otherwise approve. propose_task for unrelated problems
> you notice.

From milestone 4, GitHub Actions runs these prompts automatically.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| 401 | Token wrong or revoked |
| 403 "lacks the ... permission" | Create a token with that scope |
| "Agents are paused" | The global switch in the header is off |
| "is on hold" | The owner put the task on hold |
| "Proposal limit reached" | Raise "Max proposals per run" in project settings |
