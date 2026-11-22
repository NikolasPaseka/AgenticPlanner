/**
 * A tiny stand-in for the GitHub REST API, used by end-to-end tests.
 * The app talks to it through Octokit (GITHUB_API_URL). Tests read recorded
 * calls from GET /__calls and set pull request state with POST /__pr.
 */
import { createServer } from "node:http";

const port = Number(process.env.FAKE_GITHUB_PORT ?? 55434);
type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];

/** Files every fake pull request changes, for the change browser. */
const SAMPLE_FILES = [
  {
    filename: "src/login.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch: [
      "@@ -1,3 +1,4 @@",
      " import { auth } from './auth';",
      "-export const login = () => auth();",
      "+export const login = () => auth({ remember: true });",
      "+export const logout = () => auth.signOut();",
      " export default login;",
    ].join("\n"),
  },
  {
    filename: "src/login.test.ts",
    status: "added",
    additions: 1,
    deletions: 0,
    patch: ["@@ -0,0 +1 @@", "+test('login', () => {});"].join("\n"),
  },
  { filename: "public/logo.png", status: "added", additions: 0, deletions: 0 },
];
const prs = new Map<string, { state: string; merged: boolean; mergeable: boolean; headSha: string; headRef: string }>();

const json = (res: import("node:http").ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : null;
  const path = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";

  if (path === "/__calls") return json(res, 200, calls);
  if (path === "/__reset") {
    calls = [];
    prs.clear();
    return json(res, 200, {});
  }
  if (path === "/__pr") {
    prs.set(`${body.repo}#${body.number}`, { state: "open", merged: false, mergeable: true, headRef: "main", ...body.pr });
    return json(res, 200, {});
  }
  calls.push({ method, path, body });

  let m: RegExpMatchArray | null;
  if (method === "POST" && /^\/app\/installations\/\d+\/access_tokens$/.test(path)) {
    return json(res, 201, { token: "ghs_fake", expires_at: new Date(Date.now() + 3600_000).toISOString() });
  }
  if (method === "GET" && (m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/installation$/))) {
    return m[1].toLowerCase() === "missing" ? json(res, 404, { message: "Not Found" }) : json(res, 200, { id: 4242 });
  }
  if ((m = path.match(/^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/))) {
    const key = `${m[1].toLowerCase()}#${m[2]}`;
    const pr = prs.get(key) ?? { state: "open", merged: false, mergeable: true, headSha: "abc123", headRef: "agent/x" };
    if (method === "PATCH") {
      prs.set(key, { ...pr, state: body.state ?? pr.state });
      return json(res, 200, {});
    }
    return json(res, 200, {
      number: Number(m[2]),
      state: pr.state,
      merged: pr.merged,
      mergeable: pr.mergeable,
      head: { ref: pr.headRef, sha: pr.headSha },
      html_url: `https://github.com/${m[1]}/pull/${m[2]}`,
    });
  }
  if (method === "GET" && /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/files$/.test(path)) {
    return json(res, 200, SAMPLE_FILES);
  }
  if (method === "GET" && /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/commits$/.test(path)) {
    return json(res, 200, [
      {
        sha: "abc123def456",
        commit: { message: "Add login form\n\nWith tests.", author: { name: "claude", date: "2026-01-01T00:00:00Z" } },
        author: { login: "agentplanner-bot" },
      },
    ]);
  }
  if (method === "PUT" && (m = path.match(/^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)\/merge$/))) {
    const key = `${m[1].toLowerCase()}#${m[2]}`;
    const pr = prs.get(key) ?? { state: "open", merged: false, mergeable: true, headSha: "abc123", headRef: "x" };
    if (body.sha && body.sha !== pr.headSha) return json(res, 409, { message: "Head branch was modified" });
    prs.set(key, { ...pr, state: "closed", merged: true });
    return json(res, 200, { sha: "mergesha1", merged: true });
  }
  if (method === "POST" && /\/issues\/\d+\/comments$/.test(path)) return json(res, 201, { id: 1 });
  if (method === "DELETE" && /\/git\/refs\//.test(path)) return json(res, 204);
  if (method === "POST" && /\/actions\/workflows\/[^/]+\/dispatches$/.test(path)) return json(res, 204);
  if (method === "POST" && /\/actions\/runs\/\d+\/cancel$/.test(path)) return json(res, 202, {});
  return json(res, 404, { message: `fake-github: no route for ${method} ${path}` });
}).listen(port, "127.0.0.1", () => console.log(`fake GitHub on http://localhost:${port}`));
