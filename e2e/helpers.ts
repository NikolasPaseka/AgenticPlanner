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

/** The form starts open when there are no projects yet. */
export async function openNewProjectForm(page: Page) {
  const details = visible(page.locator("details").filter({ hasText: "+ New project" }));
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
}

/** A unique project per test, so tests do not depend on each other. */
export async function createProject(page: Page, github?: { owner: string; repo: string }) {
  const key = "T" + Math.random().toString(36).slice(2, 7).toUpperCase();
  await page.goto("/");
  await openNewProjectForm(page);
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Create project" }) });
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
