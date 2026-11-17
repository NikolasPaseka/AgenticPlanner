import { Suspense } from "react";
import { devLoginEnabled } from "@/auth";
import { signInDev, signInWithGitHub } from "@/app/actions";
import { Button, Card } from "@/components/ui";

const ERRORS: Record<string, string> = {
  AccessDenied: "This GitHub account is not allowed. Add its login to OWNER_GITHUB_LOGINS.",
  Configuration: "Sign-in is not configured. Check the AUTH_GITHUB_* environment variables.",
};

async function SignInError({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;
  if (!code) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {ERRORS[code] ?? "Sign-in failed. Please try again."}
    </p>
  );
}

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="flex w-full max-w-sm flex-col gap-4 p-6">
        <div className="flex items-center gap-2 font-semibold">
          <span aria-hidden className="grid size-6 place-items-center rounded-md bg-accent text-xs text-accent-fg">
            AP
          </span>
          AgentPlanner
        </div>
        <p className="text-sm text-muted">Sign in with the GitHub account that owns your projects.</p>
        <Suspense>
          <SignInError searchParams={searchParams} />
        </Suspense>
        <form action={signInWithGitHub}>
          <Button type="submit" variant="primary" className="w-full">
            Continue with GitHub
          </Button>
        </form>
        {devLoginEnabled && (
          <form action={signInDev}>
            <Button type="submit" className="w-full">
              Development login
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
