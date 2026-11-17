# Testing

Every milestone is tested locally before it is deployed to Vercel.

## Test layers

| Layer | Command | What it covers | Needs |
|-------|---------|----------------|-------|
| Unit | `npm test` | State machine, dispatch rules, services against an in-memory Postgres (PGlite) with the real migrations | Nothing |
| End-to-end | `npm run test:e2e` | The real app in Chrome: sign-in, forms, buttons, layout | Google Chrome installed; no other `next dev` running |
| Static | `npm run lint`, `npm run typecheck`, `npm run build` | Code quality, types, Next.js build rules | Nothing |

CI runs all of them on every pull request.

`npm run test:e2e` starts its own throwaway database and dev server on ports
55433 and 3101, signs in with the development login, and runs the specs in
[e2e/](../e2e/). Use `npx playwright test --ui` to watch the tests run.

## Running the app locally

```bash
npm run db:local     # terminal 1: embedded Postgres on localhost:5432, migrations applied
npm run dev          # terminal 2: http://localhost:3000
```

`.env.local` needs:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
AUTH_SECRET=<run: npx auth secret>
AUTH_DEV_LOGIN=<your GitHub login>   # enables "Development login" on the sign-in page
OWNER_GITHUB_LOGINS=<your GitHub login>
```

The development login only works with `npm run dev`. Production builds and
Vercel deployments ignore it. Local data is kept in `.pglite/`; delete the
folder to start fresh.

To test the real GitHub sign-in locally, create a second GitHub OAuth app
with callback `http://localhost:3000/api/auth/callback/github` and set
`AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`.

## Local test checklist per milestone

Automated specs cover each item marked (auto). Check the others by hand
before merging the milestone.

### M1: Task board
- [x] (auto) Signed-out visitors are redirected to sign-in.
- [x] (auto) Create a project; a duplicate task key shows an error.
- [x] (auto) Add tasks to Todo and Backlog; tasks are listed vertically in groups.
- [x] (auto) Group by status, priority, or type; search by title or key.
- [x] (auto) Edit a task; the timeline shows which fields changed.
- [x] (auto) Move a task between statuses; put it on hold and release it.
- [x] (auto) Comment on a task.
- [x] (auto) Accept a task proposed by an agent.
- [x] (auto) Global agents switch pauses and resumes, and the banner shows.
- [x] (auto) Project settings save and reload.
- [x] (auto) Pages fit a phone screen.
- [ ] Sign in with your real GitHub account (needs the OAuth app).
- [ ] A GitHub account not in `OWNER_GITHUB_LOGINS` is rejected.
- [ ] Dark mode looks right.

### M2: Agent API
- [x] (auto) Create and revoke an API token; a revoked token is rejected.
- [x] (auto) An MCP client lists tools, claims a task, links a branch, comments, submits for review, proposes a task, and finishes the run; the UI shows all of it.
- [x] (auto) A reviewer agent requests changes with findings; the task goes back.
- [x] (auto) A held task or paused agents refuse the claim.
- [x] (auto) REST: 401 without or with a revoked token, 403 without the scope.
- [x] (auto) Agents cannot merge or accept proposals (service tests).
- [ ] Claude Code on your machine connects (see [agent-setup.md](agent-setup.md)) and finishes a small real task.

### M3: GitHub integration
Automated tests use a fake GitHub API (`e2e/fake-github.mts`) and signed webhooks.
- [x] (auto) Webhooks with a bad signature are rejected; duplicates are ignored.
- [x] (auto) Connect finds the App installation, or explains that it is missing.
- [x] (auto) A PR referencing `KEY-n` links to the task; checks show in the review queue.
- [x] (auto) Approve merges with a merge commit at the reviewed commit, and deletes the agent branch.
- [x] (auto) Approve refuses if new commits arrived, checks fail, or the PR has conflicts.
- [x] (auto) Request changes comments on the PR; Reject closes it.
- [x] (auto) A PR merged on GitHub by someone who is not the owner does not count as approval.
- [ ] Create the real GitHub App ([github-app.md](github-app.md)), install it on a test repository, and connect.
- [ ] Open a real PR with `AgentPlanner: KEY-n`; it links and shows checks.
- [ ] Approve it in AgentPlanner; GitHub shows a merge commit by the App.

### M4: Automated agents
- [ ] With agents on and auto-dispatch on, a Todo task starts a workflow run.
- [ ] Global switch off: nothing starts. Task on hold: it is skipped.
- [ ] Stop cancels the Actions run, keeps the branch, and holds the task.
- [ ] Request changes re-dispatches the developer agent.

### M5: Vercel
- [ ] The preview URL appears on the task when the PR deploys.
- [ ] After merge, the production deploy moves the task to Done.
