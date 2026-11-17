import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateAgent } from "@/lib/api/auth";
import { buildMcpServer } from "@/lib/mcp/server";

// MCP over Streamable HTTP, stateless: every request carries the bearer token and
// gets a fresh server, which fits serverless functions on Vercel.
export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateAgent(req);
  if ("error" in auth) return auth.error;
  const server = buildMcpServer(auth.db, auth.ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // The JSON response is fully built at this point.
    void server.close();
  }
}

function methodNotAllowed() {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this server is stateless, use POST" }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
