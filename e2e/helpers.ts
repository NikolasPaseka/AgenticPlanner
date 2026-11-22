import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, type Page } from "@playwright/test";

/** Next.js keeps previous pages mounted but hidden, so tests target visible elements only. */
export const visible = <T extends { locator(s: string): T }>(l: T) => l.locator("visible=true");

export async function signIn(page: Page) {
  await page.goto("/");
  await page.waitForURL(/\/signin/);
  await page.getByRole("button", { name: "Development login" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** Opens the New project dialog on the projects page and returns it. */
export async function openNewProjectForm(page: Page) {
  await visible(page.getByRole("button", { name: "New project" })).first().click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A unique project per test, so tests do not depend on each other. */
export async function createProject(page: Page, github?: { owner: string; repo: string }) {
  const key = "T" + Math.random().toString(36).slice(2, 7).toUpperCase();
  await page.goto("/");
  const form = await openNewProjectForm(page);
  await form.getByLabel("Name").fill(`Project ${key}`);
  await form.getByLabel("Task key").fill(key.toLowerCase());
  if (github) {
    await form.getByLabel("GitHub owner").fill(github.owner);
    await form.getByLabel("GitHub repository").fill(github.repo);
  }
  await form.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(new RegExp(`/projects/project-${key.toLowerCase()}$`));
  return { key, slug: `project-${key.toLowerCase()}` };
}

/** Adds a task through the New task dialog; call it on the project's Planned tab. */
export async function addTask(page: Page, title: string, opts: { priority?: string; status?: string } = {}) {
  await visible(page.getByRole("button", { name: "New task" })).click();
  const form = page.getByRole("dialog", { name: "New task" });
  await expect(form).toBeVisible();
  await form.getByLabel("Title").fill(title);
  if (opts.priority) await form.locator('select[name="priority"]').selectOption(opts.priority);
  if (opts.status) await form.locator('select[name="status"]').selectOption(opts.status);
  await form.getByRole("button", { name: "Add task" }).click();
  await expect(form).toBeHidden();
  await expect(visible(page.getByRole("link", { name: new RegExp(title) }))).toBeVisible();
}

export async function createToken(page: Page, slug: string, name: string, scopes?: string[]) {
  await page.goto(`/projects/${slug}/settings`);
  await visible(page.locator('input[name="name"][placeholder="claude-dev"]')).fill(name);
  if (scopes) {
    for (const box of await visible(page.locator('input[name="scopes"]')).all()) {
      const value = await box.getAttribute("value");
      if (!scopes.includes(value!)) await box.uncheck();
    }
  }
  await visible(page.getByRole("button", { name: "Create token" })).click();
  const token = (await visible(page.getByTestId("new-token")).textContent())!.trim();
  expect(token).toMatch(/^ap_/);
  return token;
}

export async function mcpClient(baseURL: string, token: string) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

type ToolOut = { content: { type: string; text: string }[]; isError?: boolean };
export async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as ToolOut;
  const text = res.content[0]?.text ?? "";
  return { isError: !!res.isError, text, json: res.isError ? null : JSON.parse(text) };
}

export async function setAutoDispatch(page: Page, slug: string, on: boolean) {
  await page.goto(`/projects/${slug}/settings`);
  const box = visible(page.locator('input[name="autoDispatch"]'));
  if (on) await box.check();
  else await box.uncheck();
  await visible(page.getByRole("button", { name: "Save settings" })).click();
  await expect(visible(page.getByText("Saved."))).toBeVisible();
}

export async function connectRepo(page: Page, slug: string) {
  await page.goto(`/projects/${slug}/settings`);
  await visible(page.getByRole("button", { name: "Connect" })).click();
  await expect(visible(page.getByText(/installation \d+/))).toBeVisible();
}
