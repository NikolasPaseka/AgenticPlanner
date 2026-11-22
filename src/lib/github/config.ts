export function githubConfigured(): boolean {
  return !!process.env.GITHUB_APP_ID && !!process.env.GITHUB_APP_PRIVATE_KEY;
}

/** Install link for the App, if GITHUB_APP_SLUG is set (the App's URL name). */
export function githubAppInstallUrl(): string | null {
  const slug = process.env.GITHUB_APP_SLUG;
  return slug ? `https://github.com/apps/${slug}/installations/new` : null;
}
