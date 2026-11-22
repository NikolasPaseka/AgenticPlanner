import { App, Octokit } from "octokit";

export type PullRequestFile = {
  filename: string;
  previousFilename?: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** Unified diff. GitHub leaves it out for binary and very large files. */
  patch?: string;
};

export type PullRequestCommit = { sha: string; message: string; author: string; date: string | null };

/** What AgentPlanner needs from GitHub. Tests use a fake; production uses the GitHub App. */
export interface GitHubGateway {
  findInstallation(owner: string, repo: string): Promise<number | null>;
  getPullRequest(
    installationId: number,
    owner: string,
    repo: string,
    number: number,
  ): Promise<{ state: "open" | "closed"; merged: boolean; mergeable: boolean | null; headRef: string; headSha: string; htmlUrl: string }>;
  listPullRequestFiles(installationId: number, owner: string, repo: string, number: number): Promise<PullRequestFile[]>;
  listPullRequestCommits(installationId: number, owner: string, repo: string, number: number): Promise<PullRequestCommit[]>;
  mergePullRequest(
    installationId: number,
    owner: string,
    repo: string,
    number: number,
    opts: { method: "merge" | "squash" | "rebase"; title: string; sha: string },
  ): Promise<{ sha: string }>;
  closePullRequest(installationId: number, owner: string, repo: string, number: number): Promise<void>;
  comment(installationId: number, owner: string, repo: string, number: number, body: string): Promise<void>;
  deleteBranch(installationId: number, owner: string, repo: string, branch: string): Promise<void>;
  dispatchWorkflow(
    installationId: number,
    owner: string,
    repo: string,
    workflow: string,
    ref: string,
    inputs: Record<string, string>,
  ): Promise<void>;
  cancelWorkflowRun(installationId: number, owner: string, repo: string, runId: number): Promise<void>;
}

export class GitHubNotConfiguredError extends Error {
  constructor() {
    super("The GitHub App is not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.");
    this.name = "GitHubNotConfiguredError";
  }
}

function createApp(): App {
  const appId = process.env.GITHUB_APP_ID;
  // Vercel env vars often store the PEM with literal "\n".
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !privateKey) throw new GitHubNotConfiguredError();
  const baseUrl = process.env.GITHUB_API_URL; // Only set for tests against a fake GitHub.
  return new App({
    appId,
    privateKey,
    ...(baseUrl ? { Octokit: Octokit.defaults({ baseUrl }) } : {}),
  });
}

export function createGitHubGateway(): GitHubGateway {
  let app: App | undefined;
  const getApp = () => (app ??= createApp());
  const kit = (installationId: number) => getApp().getInstallationOctokit(installationId);

  return {
    async findInstallation(owner, repo) {
      try {
        const { data } = await getApp().octokit.request("GET /repos/{owner}/{repo}/installation", { owner, repo });
        return data.id;
      } catch (e) {
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    },
    async getPullRequest(installationId, owner, repo, number) {
      const { data } = await (await kit(installationId)).request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner,
        repo,
        pull_number: number,
      });
      return {
        state: data.state as "open" | "closed",
        merged: data.merged,
        mergeable: data.mergeable,
        headRef: data.head.ref,
        headSha: data.head.sha,
        htmlUrl: data.html_url,
      };
    },
    async listPullRequestFiles(installationId, owner, repo, number) {
      const octokit = await kit(installationId);
      const files: PullRequestFile[] = [];
      // GitHub returns at most 3000 files, 100 per page.
      for (let page = 1; page <= 30; page++) {
        const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
          owner,
          repo,
          pull_number: number,
          per_page: 100,
          page,
        });
        for (const f of data) {
          files.push({
            filename: f.filename,
            previousFilename: f.previous_filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch,
          });
        }
        if (data.length < 100) break;
      }
      return files;
    },
    async listPullRequestCommits(installationId, owner, repo, number) {
      const { data } = await (await kit(installationId)).request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/commits",
        { owner, repo, pull_number: number, per_page: 100 },
      );
      return data.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.author?.login ?? c.commit.author?.name ?? "unknown",
        date: c.commit.author?.date ?? null,
      }));
    },
    async mergePullRequest(installationId, owner, repo, number, { method, title, sha }) {
      const { data } = await (await kit(installationId)).request("PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge", {
        owner,
        repo,
        pull_number: number,
        merge_method: method,
        commit_title: title,
        sha, // GitHub refuses the merge if the PR head moved since the owner reviewed it.
      });
      return { sha: data.sha };
    },
    async closePullRequest(installationId, owner, repo, number) {
      await (await kit(installationId)).request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner,
        repo,
        pull_number: number,
        state: "closed",
      });
    },
    async comment(installationId, owner, repo, number, body) {
      await (await kit(installationId)).request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner,
        repo,
        issue_number: number,
        body,
      });
    },
    async deleteBranch(installationId, owner, repo, branch) {
      await (await kit(installationId)).request("DELETE /repos/{owner}/{repo}/git/refs/{ref}", {
        owner,
        repo,
        ref: `heads/${branch}`,
      });
    },
    async dispatchWorkflow(installationId, owner, repo, workflow, ref, inputs) {
      await (await kit(installationId)).request(
        "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
        { owner, repo, workflow_id: workflow, ref, inputs },
      );
    },
    async cancelWorkflowRun(installationId, owner, repo, runId) {
      await (await kit(installationId)).request("POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel", {
        owner,
        repo,
        run_id: runId,
      });
    },
  };
}

let gateway: GitHubGateway | undefined;

export function getGitHub(): GitHubGateway {
  gateway ??= createGitHubGateway();
  return gateway;
}
