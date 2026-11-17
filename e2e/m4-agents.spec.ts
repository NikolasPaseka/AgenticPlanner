import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_WEBHOOK_SECRET, FAKE_GITHUB_URL } from "../playwright.config";
import { addTask, connectRepo, createProject, setAutoDispatch, signIn, visible } from "./helpers";

// Milestone 4: automated agents (dispatcher, Stop, Run agent now). See docs/testing.md.

type Call = { method: string; path: string; body: { ref?: string; inputs?: { task_key: string; run_id: string } } | null };

async function dispatches(request: APIRequestContext, repo: string) {
  const calls: Call[] = await (await request.get(`${FAKE_GITHUB_URL}/__calls`)).json();
  return calls.filter((c) => c.path === `/repos/octo/${repo}/actions/workflows/agentplanner-develop.yml/dispatches`);
}

async function webhook(request: APIRequestContext, event: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return request.post("/api/webhooks/github", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": `m4-${Date.now()}-${Math.random()}`,
      "x-hub-signature-256": "sha256=" + createHmac("sha256", E2E_WEBHOOK_SECRET).update(body).digest("hex"),
    },
  });
}

async function connectedProject(page: import("@playwright/test").Page, autoDispatch: boolean) {
  const repo = `repo-${Date.now().toString(36)}`;
  const { key, slug } = await createProject(page, { owner: "octo", repo });
  await setAutoDispatch(page, slug, autoDispatch);
  await connectRepo(page, slug);
  await page.goto(`/projects/${slug}`);
  return { key, slug, repo };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("a new Todo task is dispatched automatically and can be stopped", async ({ page, request }) => {
  const { key, slug, repo } = await connectedProject(page, true);
  await addTask(page, "Automate me", { priority: "high" });

  await expect.poll(async () => (await dispatches(request, repo)).length, { timeout: 15_000 }).toBe(1);
  const [call] = await dispatches(request, repo);
  expect(call.body).toMatchObject({ ref: "main", inputs: { task_key: `${key}-1` } });
  const runId = call.body!.inputs!.run_id;

  // GitHub reports the run; AgentPlanner links it by the run id in the run name.
  await webhook(request, "workflow_run", {
    action: "in_progress",
    repository: { name: repo, owner: { login: "octo" } },
    workflow_run: { id: 777, display_title: `AgentPlanner ${key}-1 run ${runId}`, html_url: "https://github.com/x", status: "in_progress", conclusion: null },
  });

  await page.goto(`/projects/${slug}/runs`);
  await expect(visible(page.getByText("1 of 1 agent slots in use"))).toBeVisible();
  await visible(page.getByRole("button", { name: "Stop" })).click();
  await visible(page.getByRole("button", { name: "Stop agent" })).click();
  await expect(visible(page.getByText("stopped by e2e-owner"))).toBeVisible();

  const calls: Call[] = await (await request.get(`${FAKE_GITHUB_URL}/__calls`)).json();
  expect(calls.some((c) => c.method === "POST" && c.path === `/repos/octo/${repo}/actions/runs/777/cancel`)).toBe(true);

  await page.goto(`/projects/${slug}/tasks/1`);
  await expect(visible(page.getByText("stopped the agent run and put the task on hold"))).toBeVisible();
  await expect(visible(page.getByRole("button", { name: "Release hold" }))).toBeVisible();
  // The held task is not picked up again.
  await page.waitForTimeout(1500);
  expect(await dispatches(request, repo)).toHaveLength(1);
});

test("nothing is dispatched while agents are paused; switching on starts work", async ({ page, request }) => {
  const { repo } = await connectedProject(page, true);
  const sw = visible(page.getByRole("switch"));
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await addTask(page, "Wait for me");
  await page.waitForTimeout(1500);
  expect(await dispatches(request, repo)).toHaveLength(0);

  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await dispatches(request, repo)).length, { timeout: 15_000 }).toBe(1);
});

test("Run agent now starts one task when auto-dispatch is off", async ({ page, request }) => {
  const { key, slug, repo } = await connectedProject(page, false);
  await addTask(page, "Manual start");
  await page.waitForTimeout(1000);
  expect(await dispatches(request, repo)).toHaveLength(0);

  await page.goto(`/projects/${slug}/tasks/1`);
  await visible(page.getByRole("button", { name: "Run agent now" })).click();
  await expect(visible(page.getByText("started an agent run"))).toBeVisible();
  const [call] = await dispatches(request, repo);
  expect(call.body?.inputs?.task_key).toBe(`${key}-1`);
});

test("a run that ends without a review puts the task on hold", async ({ page, request }) => {
  const { key, slug, repo } = await connectedProject(page, true);
  await addTask(page, "Will fail");
  await expect.poll(async () => (await dispatches(request, repo)).length, { timeout: 15_000 }).toBe(1);
  const runId = (await dispatches(request, repo))[0].body!.inputs!.run_id;
  await webhook(request, "workflow_run", {
    action: "completed",
    repository: { name: repo, owner: { login: "octo" } },
    workflow_run: { id: 778, display_title: `AgentPlanner ${key}-1 run ${runId}`, html_url: "https://github.com/x", status: "completed", conclusion: "failure" },
  });
  await page.goto(`/projects/${slug}/tasks/1`);
  await expect(visible(page.getByText(/saw the agent run end \(failure\)/))).toBeVisible();
  await expect(visible(page.getByRole("button", { name: "Release hold" }))).toBeVisible();
});
