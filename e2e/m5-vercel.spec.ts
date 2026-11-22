import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_WEBHOOK_SECRET } from "../playwright.config";
import { addTask, call, connectRepo, createProject, createToken, mcpClient, setAutoDispatch, signIn, visible } from "./helpers";

// Milestone 5: Vercel deployments reported through GitHub deployment_status. See docs/testing.md.

async function webhook(request: APIRequestContext, event: string, payload: unknown) {
  const body = JSON.stringify(payload);
  const res = await request.post("/api/webhooks/github", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": `m5-${Date.now()}-${Math.random()}`,
      "x-hub-signature-256": "sha256=" + createHmac("sha256", E2E_WEBHOOK_SECRET).update(body).digest("hex"),
    },
  });
  expect(res.status()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("preview URL shows in review; production deploy marks the task done", async ({ page, baseURL, request }) => {
  const repo = `repo-${Date.now().toString(36)}`;
  const { key, slug } = await createProject(page, { owner: "octo", repo });
  await setAutoDispatch(page, slug, false);
  await connectRepo(page, slug);
  await page.goto(`/projects/${slug}`);
  await addTask(page, "Ship it");

  const client = await mcpClient(baseURL!, await createToken(page, slug, "claude-dev"));
  await call(client, "claim_task", { key: `${key}-1` });
  await call(client, "submit_for_review", { key: `${key}-1`, summary: "Ready.", prNumber: 3, branch: `agent/${key}-1-ship-it` });
  await client.close();
  await webhook(request, "pull_request", {
    action: "opened",
    repository: { name: repo, owner: { login: "octo" } },
    pull_request: {
      number: 3,
      title: `${key}-1: Ship it`,
      body: `AgentPlanner: ${key}-1`,
      html_url: `https://github.com/octo/${repo}/pull/3`,
      head: { ref: `agent/${key}-1-ship-it`, sha: "abc123" },
    },
  });

  const deployment = (environment: string, sha: string, ref: string, url: string) => ({
    repository: { name: repo, owner: { login: "octo" } },
    deployment: { sha, ref, environment, created_at: new Date(Date.now() + 5_000).toISOString() },
    deployment_status: { state: "success", environment, environment_url: url },
  });
  await webhook(request, "deployment_status", deployment("Preview", "abc123", `agent/${key}-1-ship-it`, "https://ship-it-preview.vercel.app"));

  await page.goto(`/projects/${slug}/review/1`);
  await expect(visible(page.getByRole("link", { name: "Preview" }))).toHaveAttribute("href", "https://ship-it-preview.vercel.app");
  await visible(page.getByRole("button", { name: "Approve and merge" })).click();
  await expect(visible(page.getByText("Nothing to review right now."))).toBeVisible();

  await webhook(request, "deployment_status", deployment("Production", "mergesha1", "main", "https://app.vercel.app"));
  await page.goto(`/projects/${slug}/tasks/1`);
  await expect(visible(page.getByText("moved it from Merged to Done"))).toBeVisible();
  await expect(visible(page.getByText("In production"))).toBeVisible();
});
