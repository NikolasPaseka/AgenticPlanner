import { expect, test } from "@playwright/test";
import { addTask, call, createProject, createToken, mcpClient, signIn, visible } from "./helpers";

// Milestone 2: agent API (MCP + REST). See docs/testing.md.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("an agent works a task through MCP and the owner sees it", async ({ page, baseURL }) => {
  const { key, slug } = await createProject(page);
  await addTask(page, "Add login page", { priority: "high" });
  const token = await createToken(page, slug, "claude-dev");
  const client = await mcpClient(baseURL!, token);

  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(
    expect.arrayContaining(["list_tasks", "get_task", "claim_task", "submit_for_review", "propose_task", "finish_run"]),
  );

  const listed = await call(client, "list_tasks", { status: "todo" });
  expect(listed.json.map((t: { key: string }) => t.key)).toEqual([`${key}-1`]);

  const claim = await call(client, "claim_task", { key: `${key}-1` });
  expect(claim.json.task.status).toBe("in_progress");
  await call(client, "link_branch", { key: `${key}-1`, branch: `agent/${key}-1-add-login-page` });
  await call(client, "update_progress", { key: `${key}-1`, message: "Login form built, writing tests." });
  await call(client, "submit_for_review", { key: `${key}-1`, summary: "Login page done; 4 tests added." });
  await call(client, "propose_task", { title: "Add password reset", type: "feature", parentKey: `${key}-1`, runId: claim.json.runId });
  await call(client, "finish_run", { runId: claim.json.runId, status: "succeeded", costUsd: 0.31 });

  // Agents cannot merge: there is no tool for it, and moving to merged is owner-only.
  const second = await call(client, "claim_task", { key: `${key}-1` });
  expect(second.isError).toBe(true);
  await client.close();

  await page.goto(`/projects/${slug}`);
  await expect(visible(page.getByRole("heading", { name: "Proposed by agents" }))).toBeVisible();
  await visible(page.getByRole("link", { name: "Review (1)" })).click();
  await expect(visible(page.getByRole("link", { name: /Add login page/ }))).toBeVisible();
  await page.goto(`/projects/${slug}/tasks/1`);
  await expect(visible(page.getByText("Login page done; 4 tests added."))).toBeVisible();
  await expect(visible(page.getByText(`linked branch agent/${key}-1-add-login-page`))).toBeVisible();
  await expect(visible(page.getByRole("heading", { name: "Agent runs" }))).toBeVisible();
  await expect(visible(page.getByText("succeeded"))).toBeVisible();
});

test("a reviewer agent requests changes with findings", async ({ page, baseURL }) => {
  const { key, slug } = await createProject(page);
  await addTask(page, "Refactor API");
  const dev = await mcpClient(baseURL!, await createToken(page, slug, "claude-dev"));
  const reviewer = await mcpClient(baseURL!, await createToken(page, slug, "claude-review"));
  await call(dev, "claim_task", { key: `${key}-1` });
  await call(dev, "submit_for_review", { key: `${key}-1`, summary: "Refactored" });
  const review = await call(reviewer, "record_review", {
    key: `${key}-1`,
    verdict: "request_changes",
    body: "Error handling is missing.",
    findings: [{ severity: "major", file: "src/api.ts", line: 42, message: "Unhandled rejection" }],
  });
  expect(review.isError).toBe(false);
  await dev.close();
  await reviewer.close();

  await page.goto(`/projects/${slug}/tasks/1`);
  await expect(visible(page.getByRole("heading", { name: "Reviews" }))).toBeVisible();
  await expect(visible(page.getByText("Unhandled rejection"))).toBeVisible();
  await expect(visible(page.getByText("moved it from In review to Changes requested"))).toBeVisible();
});

test("paused agents and held tasks cannot be claimed", async ({ page, baseURL }) => {
  const { key, slug } = await createProject(page);
  await addTask(page, "Careful change");
  const client = await mcpClient(baseURL!, await createToken(page, slug, "claude-dev"));

  await page.goto(`/projects/${slug}/tasks/1`);
  await visible(page.getByRole("button", { name: "Put on hold" })).click();
  await expect(visible(page.getByRole("button", { name: "Release hold" }))).toBeVisible();
  expect((await call(client, "claim_task", { key: `${key}-1` })).text).toContain("on hold");
  await visible(page.getByRole("button", { name: "Release hold" })).click();
  await expect(visible(page.getByRole("button", { name: "Put on hold" }))).toBeVisible();

  const sw = visible(page.getByRole("switch"));
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  expect((await call(client, "claim_task", { key: `${key}-1` })).text).toContain("paused");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  expect((await call(client, "claim_task", { key: `${key}-1` })).isError).toBe(false);
  await client.close();
});

test("REST API: auth, scopes, and revocation", async ({ page, request }) => {
  const { key, slug } = await createProject(page);
  await addTask(page, "Read me");
  const readOnly = await createToken(page, slug, "reader", ["tasks:read"]);
  const auth = { Authorization: `Bearer ${readOnly}` };

  expect((await request.get("/api/v1/tasks")).status()).toBe(401);
  expect((await request.get("/api/v1/tasks", { headers: { Authorization: "Bearer ap_nope" } })).status()).toBe(401);

  const me = await request.get("/api/v1/me", { headers: auth });
  expect(await me.json()).toMatchObject({ agent: "reader", scopes: ["tasks:read"], project: { key } });

  const tasks = await request.get("/api/v1/tasks", { headers: auth });
  expect((await tasks.json()).map((t: { title: string }) => t.title)).toEqual(["Read me"]);

  const claim = await request.post(`/api/v1/tasks/${key}-1/claim`, { headers: auth, data: {} });
  expect(claim.status()).toBe(403);

  // Revoke in the UI; the token stops working.
  await page.goto(`/projects/${slug}/settings`);
  await visible(page.getByRole("button", { name: "Revoke" })).click();
  await expect(visible(page.getByText("Revoked"))).toBeVisible();
  expect((await request.get("/api/v1/tasks", { headers: auth })).status()).toBe(401);
});
