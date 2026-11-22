# GitHub App setup

AgentPlanner uses a GitHub App to read pull requests and checks, comment,
close and merge approved PRs, and start agent workflows. You create the App
once; it can be installed on any of your repositories.

## 1. Create the App

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.

| Field | Value |
|-------|-------|
| GitHub App name | e.g. `agentplanner-nikolas` (the URL name becomes `GITHUB_APP_SLUG`) |
| Homepage URL | Your AgentPlanner URL |
| Webhook URL | `https://<your-app>/api/webhooks/github` |
| Webhook secret | A long random string (`GITHUB_WEBHOOK_SECRET`) |
| Where can this App be installed? | Only on this account |

Repository permissions:

| Permission | Access | Used for |
|------------|--------|----------|
| Contents | Read and write | Merge, delete agent branches |
| Pull requests | Read and write | Read, comment, close |
| Issues | Read and write | PR comments use the issues API |
| Checks | Read-only | CI status |
| Actions | Read and write | Start and cancel agent workflows (M4) |
| Deployments | Read-only | Preview and production URLs (M5) |
| Metadata | Read-only | Required |

Subscribe to events: **Pull request**, **Check suite**, **Workflow run**,
**Deployment status**. Installation events are sent automatically.

After creating it:

1. Note the **App ID** (`GITHUB_APP_ID`).
2. **Generate a private key** and download the `.pem` file
   (`GITHUB_APP_PRIVATE_KEY`).

## 2. Configure AgentPlanner

Set these in Vercel (Production and Preview) and in `.env.local` for local
runs:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=agentplanner-nikolas
GITHUB_WEBHOOK_SECRET=<the webhook secret>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

The private key can be pasted with real line breaks in Vercel, or on one
line with `\n`; both work.

## 3. Install and connect

1. Install the App on the repository (Project settings shows an install link
   when `GITHUB_APP_SLUG` is set).
2. In **Project settings**, enter the GitHub owner and repository, save, and
   click **Connect**.

## 4. Protect main

In the repository: Settings → Branches → add a rule for `main`:

- Require a pull request before merging.
- Require status checks to pass (select the CI jobs).
- Do not allow bypassing, except for the AgentPlanner App if you require
  reviews (the App merges after your approval in AgentPlanner).

## How PRs are linked

A PR is linked to task `KEY-n` if any of these holds, checked in order:

1. The body contains `AgentPlanner: KEY-n`.
2. The title starts with `KEY-n` or `[KEY-n]`.
3. The branch is `agent/KEY-n-...` or `<anything>/KEY-n`.

## Webhooks during local development

GitHub cannot reach `localhost`. Use a tunnel and point the App's webhook URL
at it while testing, for example:

```bash
npx smee-client --url https://smee.io/<channel> --target http://localhost:3000/api/webhooks/github
```

The end-to-end tests do not need this: they run against a fake GitHub API
(`e2e/fake-github.mts`) and send signed webhooks themselves.
