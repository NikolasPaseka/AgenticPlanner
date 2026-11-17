import { headers } from "next/headers";
import Link from "next/link";
import { requireOwner } from "@/auth";
import { revokeApiTokenAction } from "@/app/actions";
import { ProjectSettingsForm } from "@/components/forms";
import { ConnectRepositoryButton } from "@/components/review";
import { CreateTokenForm } from "@/components/tokens";
import { githubAppInstallUrl, githubConfigured } from "@/lib/github/config";
import { Badge, Button, Card } from "@/components/ui";
import { getDb } from "@/lib/db";
import { getProjectBySlug } from "@/lib/services/projects";
import { listApiTokens, type ApiToken } from "@/lib/services/tokens";
import { timeAgo } from "@/lib/ui/labels";
import { orNotFound } from "@/lib/ui/load";

function TokenRow({ token }: { token: ApiToken }) {
  const revoked = !!token.revokedAt;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      <span className="font-mono text-sm font-medium">{token.name}</span>
      {revoked ? <Badge className="text-muted">Revoked</Badge> : <Badge className="text-emerald-700 dark:text-emerald-300">Active</Badge>}
      <span className="text-xs text-muted">
        {token.scopes.join(", ")} · created {timeAgo(token.createdAt)} ·{" "}
        {token.lastUsedAt ? `last used ${timeAgo(token.lastUsedAt)}` : "never used"}
      </span>
      <div className="flex-1" />
      {!revoked && (
        <form action={revokeApiTokenAction}>
          <input type="hidden" name="tokenId" value={token.id} />
          <Button type="submit" size="sm" variant="danger">
            Revoke
          </Button>
        </form>
      )}
    </li>
  );
}

export default async function ProjectSettingsPage({ params }: PageProps<"/projects/[slug]/settings">) {
  await requireOwner();
  const { slug } = await params;
  const db = getDb();
  const project = await orNotFound(getProjectBySlug(db, slug));
  const tokens = await listApiTokens(db, project.id);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted">
          <Link href="/" className="hover:underline">
            Projects
          </Link>{" "}
          /{" "}
          <Link href={`/projects/${project.slug}`} className="hover:underline">
            {project.name}
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>
      <Card className="p-4">
        <ProjectSettingsForm project={project} />
      </Card>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">GitHub</h2>
          <p className="text-sm text-muted">
            The AgentPlanner GitHub App links pull requests to tasks, reports checks, and merges approved changes.
          </p>
        </div>
        <Card className="flex flex-col gap-3 p-4 text-sm">
          {!githubConfigured() ? (
            <p>
              The GitHub App is not configured on this server. Set <code className="font-mono">GITHUB_APP_ID</code>,{" "}
              <code className="font-mono">GITHUB_APP_PRIVATE_KEY</code>, and{" "}
              <code className="font-mono">GITHUB_WEBHOOK_SECRET</code>. See docs/github-app.md.
            </p>
          ) : !project.githubOwner || !project.githubRepo ? (
            <p>Enter the GitHub owner and repository above, save, then connect.</p>
          ) : project.githubInstallationId ? (
            <p>
              <Badge className="text-emerald-700 dark:text-emerald-300">Connected</Badge>{" "}
              {project.githubOwner}/{project.githubRepo} (installation {project.githubInstallationId})
            </p>
          ) : (
            <>
              <p>
                Install the App on <span className="font-mono">{project.githubOwner}/{project.githubRepo}</span>
                {githubAppInstallUrl() && (
                  <>
                    {" "}
                    (
                    <a href={githubAppInstallUrl()!} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      install
                    </a>
                    )
                  </>
                )}
                , then click Connect.
              </p>
              <ConnectRepositoryButton projectId={project.id} />
            </>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">Agent API tokens</h2>
          <p className="text-sm text-muted">
            Agents use a token to reach this project through the MCP server or the REST API. Each token only sees
            this project. Agents can never merge, accept their own proposals, or switch agents on or off.
          </p>
        </div>
        {tokens.length > 0 && (
          <Card>
            <ul className="divide-y divide-border">
              {tokens.map((t) => (
                <TokenRow key={t.id} token={t} />
              ))}
            </ul>
          </Card>
        )}
        <Card className="p-4">
          <CreateTokenForm projectId={project.id} appUrl={`${proto}://${host}`} />
        </Card>
      </section>
    </div>
  );
}
