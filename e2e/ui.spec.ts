import { expect, test } from "@playwright/test";
import { addTask, call, connectRepo, createProject, createToken, mcpClient, setAutoDispatch, signIn, visible } from "./helpers";

// UI redesign: project tabs, New task dialog, change browser, and theme. See docs/testing.md.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("tabs split tasks into planned, in progress, review, and done", async ({ page }) => {
  const { slug } = await createProject(page);
  await addTask(page, "Plan the API");
  await addTask(page, "Someday idea", { status: "backlog" });
  await expect(visible(page.getByRole("link", { name: "Planned (2)" }))).toHaveAttribute("aria-current", "page");

  await visible(page.getByRole("link", { name: /Plan the API/ })).click();
  await visible(page.getByRole("button", { name: "Start work" })).click();
  await expect(visible(page.getByText("moved it from Todo to In progress"))).toBeVisible();

  await visible(page.getByRole("link", { name: "In progress (1)" })).click();
  await page.waitForURL(new RegExp(`/projects/${slug}/in-progress$`));
  await expect(visible(page.getByRole("link", { name: /Plan the API/ }))).toBeVisible();
  await expect(visible(page.getByRole("link", { name: /Someday idea/ }))).toHaveCount(0);

  await visible(page.getByRole("link", { name: "Planned (1)" })).click();
  await page.waitForURL(new RegExp(`/projects/${slug}$`));
  await expect(visible(page.getByRole("link", { name: /Someday idea/ }))).toBeVisible();
  await expect(visible(page.getByRole("link", { name: /Plan the API/ }))).toHaveCount(0);

  await visible(page.getByRole("link", { name: "Done (0)" })).click();
  await page.waitForURL(new RegExp(`/projects/${slug}/done$`));
  await expect(visible(page.getByText("Nothing finished yet."))).toBeVisible();
});

test("the New task dialog closes after adding and Escape dismisses it", async ({ page }) => {
  await createProject(page);
  await addTask(page, "From the dialog");
  await visible(page.getByRole("button", { name: "New task" })).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog).toBeVisible();
  // The form was reset after the last task was added.
  await expect(dialog.getByLabel("Title")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the change browser shows the PR diff with findings on their lines", async ({ page, baseURL }) => {
  const repo = `repo-${Date.now().toString(36)}`;
  const { key, slug } = await createProject(page, { owner: "octo", repo });
  await setAutoDispatch(page, slug, false);
  await connectRepo(page, slug);
  await page.goto(`/projects/${slug}`);
  await addTask(page, "Add login");

  const dev = await mcpClient(baseURL!, await createToken(page, slug, "claude-dev"));
  const reviewer = await mcpClient(baseURL!, await createToken(page, slug, "claude-review"));
  await call(dev, "claim_task", { key: `${key}-1` });
  await call(dev, "submit_for_review", { key: `${key}-1`, summary: "Login and logout added.", prNumber: 5 });
  await call(reviewer, "record_review", {
    key: `${key}-1`,
    verdict: "comment",
    body: "Looks fine.",
    findings: [
      { severity: "minor", file: "src/login.ts", line: 3, message: "Logout should clear the session cookie." },
      { severity: "nit", message: "Consider a changelog entry." },
    ],
  });
  await dev.close();
  await reviewer.close();

  await page.goto(`/projects/${slug}/review`);
  await visible(page.getByRole("link", { name: "Review changes" })).click();
  await page.waitForURL(new RegExp(`/projects/${slug}/review/1$`));

  await expect(visible(page.getByText("Login and logout added."))).toBeVisible();
  await expect(visible(page.getByText("3 files changed"))).toBeVisible();
  await expect(visible(page.getByText("1 commit", { exact: true }))).toBeVisible();
  await expect(visible(page.getByText("export const logout = () => auth.signOut();"))).toBeVisible();
  // The finding on line 3 is shown inside the diff table, next to that line.
  await expect(visible(page.locator("table").getByText("Logout should clear the session cookie."))).toBeVisible();
  await expect(visible(page.getByText("GitHub does not show a diff for this file"))).toBeVisible();
  await expect(visible(page.getByRole("button", { name: "Approve and merge" }))).toBeVisible();
});

test("the theme switch picks light, dark, or the system setting and remembers it", async ({ page }) => {
  const html = page.locator("html");
  await visible(page.getByRole("button", { name: "Dark theme" })).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(visible(page.getByRole("button", { name: "Dark theme" }))).toHaveAttribute("aria-pressed", "true");

  await visible(page.getByRole("button", { name: "Light theme" })).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(246, 247, 249)");

  await visible(page.getByRole("button", { name: "System theme" })).click();
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
});
