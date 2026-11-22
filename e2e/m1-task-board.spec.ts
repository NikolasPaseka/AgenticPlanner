import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { E2E_DATABASE_URL } from "../playwright.config";
import { addTask, createProject, openNewProjectForm, signIn, visible } from "./helpers";

// Milestone 1: manual task board. See docs/testing.md.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("redirects to sign-in when signed out", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
});

test("creates a project and rejects a duplicate key", async ({ page }) => {
  const { key } = await createProject(page);
  await page.goto("/");
  const form = await openNewProjectForm(page);
  await form.getByLabel("Name").fill("Duplicate");
  await form.getByLabel("Task key").fill(key);
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already used" })).toBeVisible();
});

test("lists tasks vertically, grouped by status, priority, or type", async ({ page }) => {
  const { slug } = await createProject(page);
  await addTask(page, "Urgent fix", { priority: "urgent" });
  await addTask(page, "Later idea", { status: "backlog" });

  await expect(visible(page.getByRole("heading", { name: "Todo" }))).toBeVisible();
  await expect(visible(page.getByRole("heading", { name: "Backlog" }))).toBeVisible();

  await visible(page.locator('select[name="group"]')).selectOption("priority");
  await expect(page).toHaveURL(/group=priority/);
  await expect(visible(page.getByRole("heading", { name: "Urgent" }))).toBeVisible();

  await page.goto(`/projects/${slug}?q=later`);
  await expect(visible(page.getByRole("link", { name: /Later idea/ }))).toBeVisible();
  await expect(visible(page.getByRole("link", { name: /Urgent fix/ }))).toHaveCount(0);
});

test("edits a task, moves it, holds it, and comments", async ({ page }) => {
  const { key } = await createProject(page);
  await addTask(page, "Build login", { priority: "high" });
  await visible(page.getByRole("link", { name: /Build login/ })).click();
  await expect(visible(page.getByText(`${key}-1`))).toBeVisible();

  await visible(page.getByText("Edit task")).click();
  await visible(page.locator('textarea[name="acceptanceCriteria"]')).fill("- GitHub sign-in works");
  await visible(page.getByRole("button", { name: "Save changes" })).click();
  await expect(visible(page.getByText("edited acceptance criteria"))).toBeVisible();

  await visible(page.getByRole("button", { name: "Start work" })).click();
  await expect(visible(page.getByText("moved it from Todo to In progress"))).toBeVisible();

  await visible(page.getByRole("button", { name: "Put on hold" })).click();
  await expect(visible(page.getByRole("button", { name: "Release hold" }))).toBeVisible();
  await expect(visible(page.getByText("put it on hold"))).toBeVisible();

  await visible(page.locator('textarea[name="body"]')).fill("Please use Auth.js");
  await visible(page.getByRole("button", { name: "Comment", exact: true })).click();
  await expect(visible(page.getByText("Please use Auth.js"))).toBeVisible();
});

test("accepts a task proposed by an agent", async ({ page }) => {
  const { slug } = await createProject(page);
  // Agents have no API until M2, so insert the proposal directly.
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  await pool.query(
    `with p as (update project set next_task_number = next_task_number + 1 where slug = $1
       returning id, next_task_number - 1 as n)
     insert into task (project_id, number, title, status, source, created_by_agent)
     select id, n, 'Agent found a bug', 'proposed', 'agent', 'analyzer' from p`,
    [slug],
  );
  await pool.end();

  await page.goto(`/projects/${slug}`);
  await expect(visible(page.getByRole("heading", { name: "Proposed by agents" }))).toBeVisible();
  await visible(page.getByRole("button", { name: "Accept" })).click();
  await expect(visible(page.getByRole("heading", { name: "Proposed by agents" }))).toHaveCount(0);
  await expect(visible(page.getByRole("link", { name: /Agent found a bug/ }))).toBeVisible();
});

test("global agents switch pauses and resumes", async ({ page }) => {
  const sw = visible(page.getByRole("switch"));
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(visible(page.getByText("Agents are paused in all projects"))).toBeVisible();
  await page.reload();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Agents are paused in all projects")).toHaveCount(0);
});

test("saves project settings", async ({ page }) => {
  const { slug } = await createProject(page);
  await page.goto(`/projects/${slug}/settings`);
  await visible(page.locator('input[name="maxParallelRuns"]')).fill("2");
  await visible(page.locator('input[name="autoDispatch"]')).uncheck();
  await visible(page.getByRole("button", { name: "Save settings" })).click();
  await expect(visible(page.getByText("Saved."))).toBeVisible();
  await page.reload();
  await expect(visible(page.locator('input[name="maxParallelRuns"]'))).toHaveValue("2");
  await expect(visible(page.locator('input[name="autoDispatch"]'))).not.toBeChecked();
});

test("fits a phone screen without horizontal scrolling", async ({ page }) => {
  const { slug } = await createProject(page);
  await addTask(page, "A task with a fairly long title to check wrapping on small screens");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/projects/${slug}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBe(0);
});
