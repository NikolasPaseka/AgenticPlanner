import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import type { Actor } from "@/lib/services/actor";

export function ownerLogins(): string[] {
  return (process.env.OWNER_GITHUB_LOGINS ?? "")
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerLogin(login: string | null | undefined): boolean {
  return !!login && ownerLogins().includes(login.toLowerCase());
}

/**
 * Local-only sign-in without GitHub, for development and screenshots.
 * Never active in production builds (Vercel previews run with NODE_ENV=production).
 */
export const devLoginEnabled =
  process.env.NODE_ENV === "development" && !!process.env.AUTH_DEV_LOGIN;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub,
    ...(devLoginEnabled
      ? [
          Credentials({
            id: "dev",
            name: "Development login",
            credentials: {},
            authorize: () => ({ id: "dev", name: process.env.AUTH_DEV_LOGIN }),
          }),
        ]
      : []),
  ],
  pages: { signIn: "/signin", error: "/signin" },
  session: { strategy: "jwt" },
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider === "dev") return devLoginEnabled;
      return isOwnerLogin(profile?.login as string | undefined);
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile) {
        token.login = profile.login as string;
        await getDb()
          .insert(users)
          .values({
            githubId: Number(profile.id),
            login: token.login,
            name: profile.name ?? null,
            avatarUrl: (profile.avatar_url as string | undefined) ?? null,
          })
          .onConflictDoUpdate({
            target: users.githubId,
            set: { login: token.login, name: profile.name ?? null },
          });
      } else if (account?.provider === "dev") {
        token.login = process.env.AUTH_DEV_LOGIN;
      }
      return token;
    },
    session({ session, token }) {
      session.user.login = token.login as string | undefined;
      return session;
    },
  },
});

/**
 * Returns the owner as an actor, or redirects to sign-in.
 * Call this at the start of every page and server action: server actions are
 * reachable by direct POST, so layout checks alone are not enough.
 */
export async function requireOwner(): Promise<Actor> {
  await connection(); // Per-request: Auth.js uses crypto, which must not run during prerender.
  const session = await auth();
  const login = session?.user?.login;
  if (!login) redirect("/signin");
  if (!isOwnerLogin(login) && !(devLoginEnabled && login === process.env.AUTH_DEV_LOGIN)) {
    redirect("/signin?error=AccessDenied");
  }
  return { kind: "owner", name: login };
}
