/** GitHub logins allowed to act as the owner (OWNER_GITHUB_LOGINS, comma-separated). */
export function ownerLogins(): string[] {
  return (process.env.OWNER_GITHUB_LOGINS ?? "")
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerLogin(login: string | null | undefined): boolean {
  return !!login && ownerLogins().includes(login.toLowerCase());
}
