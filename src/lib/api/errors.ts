import { z } from "zod";
import { InvalidTransitionError } from "@/lib/domain/tasks";
import { ForbiddenError } from "@/lib/services/agents";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/services/errors";

/** Maps expected errors to an HTTP status and a message safe to show to agents. */
export function describeError(e: unknown): { status: number; message: string } {
  if (e instanceof z.ZodError) return { status: 400, message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  if (e instanceof ValidationError) return { status: 400, message: e.message };
  if (e instanceof ForbiddenError) return { status: 403, message: e.message };
  if (e instanceof NotFoundError) return { status: 404, message: e.message };
  if (e instanceof ConflictError || e instanceof InvalidTransitionError) return { status: 409, message: e.message };
  console.error(e);
  return { status: 500, message: "Internal error" };
}
