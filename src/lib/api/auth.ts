import { getDb, type Db } from "@/lib/db";
import { agentContext, type AgentContext } from "@/lib/services/agents";
import { authenticateToken, bearerToken } from "@/lib/services/tokens";

/** Resolves the agent behind an `Authorization: Bearer` header, or returns a 401 response. */
export async function authenticateAgent(
  req: Request,
): Promise<{ db: Db; ctx: AgentContext } | { error: Response }> {
  const db = getDb();
  const auth = await authenticateToken(db, bearerToken(req.headers.get("authorization")));
  if (!auth) {
    return {
      error: Response.json(
        { error: "Missing, unknown, or revoked API token" },
        { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="agentplanner"' } },
      ),
    };
  }
  return { db, ctx: agentContext(auth.project, auth.token) };
}
