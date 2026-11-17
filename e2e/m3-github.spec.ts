import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_WEBHOOK_SECRET, FAKE_GITHUB_URL } from "../playwright.config";
import { addTask, call, createProject, createToken, mcpClient, signIn, visible } from "./helpers";

// Milestone 3: GitHub integration against a fake GitHub API. See docs/testing.md.

type Call = { method: string; path: string; body: Record<string, unknown> | null };

async function githubCalls(request: APIRequestContext): Promise<Call[]> {
  return (await request.get(`${FAKE_GITHUB_URL}/__calls`)).json();
}

let delivery = 0;
async function webhook(request: APIRequestContext, event: string, payload: unknown, secret = E2E_WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  return request.post("/api/webhooks/github", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": `e2e-${Date.now()}-${delivery++}`,
      "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
    },
  });
}

function pr(owner: string, repo: string, key: string, number: number, sha = "abc123") {
  return {
    action: "opened",
    repository: { name: repo, owner: { login: owner } },
    pull_request: {
      number,
      title: `${key}-1: Add login`,
      body: `Adds login.\n\nAgentPlanner: ${key}-1`,
      html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
      head: { ref: `agent/${key}-1-add-login`, sha },
    },
  };
}

/** Project connected to the fake GitHub, with one task an agent has submitted for review. */
async function setUpTaskInReview(page: import("@playwright/test").Page, baseURL: string, request: APIRequestContext) {
  const repo = `repo-${Date.now().toString(36)}`;
  const { key, slug } = await createProject(page, { owner: "octo", repo });
  await page.goto(`/projects/${slug}/settings`);
  await visible(page.getByRole("button", { name: "Connect" })).click();
  await expect(visible(page.getByText("installation 4242"))).toBeVisible();

  await page.goto(`/projects/${slug}`);
  await addTask(page, "Add login");
  const client = await mcpClient(baseURL, await createToken(page, slug, "claude-dev"));
  await call(client, "claim_task", { key: `${key}-1` });
  await call(client, "submit_for_review", { key: `${key}-1`, summary: "Login added with tests.", prNumber: 12 });
  await client.close();

  expect((await webhook(request, "pull_request", pr("octo", repo, key, 12))).status()).toBe(200);
  await webhook(request, "check_suite", {
    action: "completed",
    repository: { name: repo, owner: { login: "octo" } },
    check_suite: { head_sha: "abc123", conclusion: "success", pull_requests: [{ number: 12 }] },
  });
  return { key, slug, repo };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("rejects webhooks with a bad signature", async ({ request }) => {
  const res = await webhook(request, "ping", { zen: "hi" }, "wrong-secret");
  expect(res.status()).toBe(401);
  expect((await webhook(request, "ping", { zen: "hi" })).status()).toBe(200);
});

test("approve merges the PR with a merge commit at the reviewed commit", async ({ page, baseURL, request }) => {
  const { key, slug, repo } = await setUpTaskInReview(page, baseURL!, request);

  await page.goto(`/projects/${slug}`);
  await expect(visible(page.getByRole("link", { name: "Review (1)" }))).toBeVisible();
  await visible(page.getByRole("link", { name: "Review (1)" })).click();
  await page.waitForURL(/\/review$/);
  await expect(visible(page.getByText("Checks passed"))).toBeVisible();
  await expect(visible(page.getByText("Login added with tests."))).toBeVisible();
  await visible(page.getByRole("button", { name: "Approve and merge" })).click();
  await expect(visible(page.getByText("Nothing to review right now."))).toBeVisible();

  const merge = (await githubCalls(request)).find((c) => c.method === "PUT" && c.path === `/repos/octo/${repo}/pulls/12/merge`);
  expect(merge?.body).toMatchObject({ merge_method: "merge", sha: "abc123", commit_title: `${key}-1: Add login (#12)` });

  await page.goto(`/projects/${slug}/tasks/1`);
  await expect(visible(page.getByText("moved it from In review to Merged"))).toBeVisible();
  await expect(visible(page.getByText("reported checks success"))).toBeVisible();
});

test("approve refuses when new commits arrived after the review was opened", async ({ page, baseURL, request }) => {
  const { slug, repo } = await setUpTaskInReview(page, baseURL!, request);
  await page.goto(`/projects/${slug}/review`);
  await expect(visible(page.getByRole("button", { name: "Approve and merge" }))).toBeVisible();
  // The agent pushes again on GitHub, but this page still shows the old commit.
  await request.post(`${FAKE_GITHUB_URL}/__pr`, { data: { repo: `octo/${repo}`, number: 12, pr: { headSha: "newsha9" } } });
  await visible(page.getByRole("button", { name: "Approve and merge" })).click();
  await expect(visible(page.getByRole("alert").filter({ hasText: "New commits were pushed" }))).toBeVisible();
});

test("request changes comments on the PR and returns the task", async ({ page, baseURL, request }) => {
  const { slug, repo } = await setUpTaskInReview(page, baseURL!, request);
  await page.goto(`/projects/${slug}/review`);
  await visible(page.getByRole("button", { name: "Request changes" })).click();
  await visible(page.getByLabel(/What should change/)).fill("Please add a logout button too.");
  await visible(page.getByRole("button", { name: "Send back to agent" })).click();
  await expect(visible(page.getByText("Nothing to review right now."))).toBeVisible();

  const comment = (await githubCalls(request)).find((c) => c.path === `/repos/octo/${repo}/issues/12/comments`);
  expect(String(comment?.body?.body)).toContain("Please add a logout button too.");
  await page.goto(`/projects/${slug}/tasks/1`);
  await expect(visible(page.getByText("moved it from In review to Changes requested"))).toBeVisible();
});

test("reject closes the PR and returns the task to Todo", async ({ page, baseURL, request }) => {
  const { slug, repo } = await setUpTaskInReview(page, baseURL!, request);
  await page.goto(`/projects/${slug}/review`);
  await visible(page.getByRole("button", { name: "Reject" })).click();
  await visible(page.getByLabel("After rejecting")).selectOption("todo");
  await visible(page.locator('textarea[name="reason"]')).fill("Wrong approach");
  await visible(page.locator("form").filter({ has: page.locator('textarea[name="reason"]') }).getByRole("button", { name: "Reject" })).click();
  await expect(visible(page.getByText("Nothing to review right now."))).toBeVisible();

  const close = (await githubCalls(request)).find((c) => c.method === "PATCH" && c.path === `/repos/octo/${repo}/pulls/12`);
  expect(close?.body).toMatchObject({ state: "closed" });
  await page.goto(`/projects/${slug}/tasks/1`);
  await expect(visible(page.getByText("moved it from In review to Todo"))).toBeVisible();
});

test("connect explains when the App is not installed", async ({ page }) => {
  const { slug } = await createProject(page, { owner: "missing", repo: "nothing" });
  await page.goto(`/projects/${slug}/settings`);
  await visible(page.getByRole("button", { name: "Connect" })).click();
  await expect(visible(page.getByRole("alert").filter({ hasText: "not installed" }))).toBeVisible();
});
