import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies GitHub's `X-Hub-Signature-256: sha256=<hex>` header in constant time. */
export function verifyGitHubSignature(secret: string, body: string, header: string | null): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(body).digest("hex"));
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function signGitHubBody(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}
