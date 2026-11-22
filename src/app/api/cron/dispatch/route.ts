import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { githubConfigured } from "@/lib/github/config";
import { getGitHub } from "@/lib/github/gateway";
import { dispatchAll } from "@/lib/services/dispatch";

// Safety net for auto-dispatch, called by Vercel Cron (see vercel.json).
// Vercel sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request): Promise<Response> {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!githubConfigured()) return Response.json({ started: 0, reason: "GitHub App not configured" });
  const started = await dispatchAll(getDb(), getGitHub());
  return Response.json({ started });
}
