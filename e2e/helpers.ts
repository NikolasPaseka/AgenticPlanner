import { expect, type Page } from "@playwright/test";

/** Next.js keeps previous pages mounted but hidden, so tests target visible elements only. */
export const visible = <T extends { locator(s: string): T }>(l: T) => l.locator("visible=true");

export async function signIn(page: Page) {
  await page.goto("/");
  await page.waitForURL(/\/signin/);
  await page.getByRole("button", { name: "Development login" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** The form starts open when there are no projects yet. */
export async function openNewProjectForm(page: Page) {
  const details = visible(page.locator("details").filter({ hasText: "+ New project" }));
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
}

/** A unique project per test, so tests do not depend on each other. */
export async function createProject(page: Page) {
  const key = "T" + Math.random().toString(36).slice(2, 7).toUpperCase();
  await page.goto("/");
  await openNewProjectForm(page);
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Create project" }) });
  await form.getByLabel("Name").fill(`Project ${key}`);
  await form.getByLabel("Task key").fill(key.toLowerCase());
  await form.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(new RegExp(`/projects/project-${key.toLowerCase()}$`));
  return { key, slug: `project-${key.toLowerCase()}` };
}

export async function addTask(page: Page, title: string, opts: { priority?: string; status?: string } = {}) {
  const details = visible(page.locator("details").filter({ hasText: "+ New task" }));
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  const form = details.locator("form");
  await form.getByLabel("Title").fill(title);
  if (opts.priority) await form.locator('select[name="priority"]').selectOption(opts.priority);
  if (opts.status) await form.locator('select[name="status"]').selectOption(opts.status);
  await form.getByRole("button", { name: "Add task" }).click();
  await expect(visible(page.getByRole("link", { name: new RegExp(title) }))).toBeVisible();
}
