# Security

## Identities

| Identity | Auth | Scope |
|----------|------|-------|
| Owner | GitHub OAuth through Auth.js; allow-list of GitHub logins | Everything |
| Agent | Project API token, stored as a SHA-256 hash, shown once | One project; scopes such as `tasks:read`, `tasks:write`, `reviews:write`, `tasks:propose` |
| GitHub App | JWT to short-lived installation tokens | Installed repos only |

## GitHub App permissions

- Contents: read and write (merge, delete branch)
- Pull requests: read and write
- Checks, Actions, Deployments: read
- Actions: write (only for `workflow_dispatch` and cancelling agent runs)
- Metadata: read

## Development login

`AUTH_DEV_LOGIN` adds a password-less "Development login" button. It is only
active when `NODE_ENV` is `development` (`npm run dev`). `next build` and all
Vercel deployments run in production mode, so the button and the provider do
not exist there. Never set `AUTH_DEV_LOGIN` in Vercel.

## Rules

- **Only the owner merges.** The merge endpoint requires a session for an
  allow-listed owner and re-checks PR state, mergeability, and checks first.
- **Agents never get the GitHub App key.** In Actions they use the built-in
  `GITHUB_TOKEN`, limited to pushing branches and opening PRs.
- **Branch protection** on `main` blocks direct pushes, including by agents.
- **Webhook signatures** are verified with constant-time comparison; replayed
  delivery ids are ignored.
- **Prompt injection:** task descriptions, PR comments, and issue text are
  untrusted input to agents. Role prompts tell agents to treat them as data,
  and agents cannot reach owner-only actions regardless of what text says.
- **Secrets** live in Vercel environment variables and GitHub Actions secrets,
  never in the database or in prompts.
- **Audit:** every state change is a `task_event` with the actor.
- **Limits:** rate limits per token, caps on proposed tasks per run, and run
  timeouts.
