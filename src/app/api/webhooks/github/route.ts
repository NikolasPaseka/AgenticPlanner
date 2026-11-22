import { getDb } from "@/lib/db";
import { verifyGitHubSignature } from "@/lib/github/webhook-signature";
import { scheduleDispatch } from "@/lib/dispatch-trigger";
import { handleGitHubEvent, recordDelivery } from "@/lib/services/github";

// GitHub App webhook receiver. Configure the App's webhook URL as
// https://<your-app>/api/webhooks/github with GITHUB_WEBHOOK_SECRET.
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook secret not configured" }, { status: 503 });

  const body = await req.text();
  if (!verifyGitHubSignature(secret, body, req.headers.get("x-hub-signature-256"))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  const name = req.headers.get("x-github-event") ?? "";
  const delivery = req.headers.get("x-github-delivery");
  const db = getDb();
  if (delivery && !(await recordDelivery(db, delivery, "github"))) {
    return Response.json({ ok: true, result: "duplicate delivery" });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const result = await handleGitHubEvent(db, name, payload);
    if (name === "workflow_run" || name === "pull_request") scheduleDispatch();
    return Response.json({ ok: true, result });
  } catch (e) {
    console.error("github webhook failed", name, e);
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
