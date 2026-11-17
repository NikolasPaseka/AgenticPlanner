import { notFound } from "next/navigation";
import { NotFoundError } from "@/lib/services/errors";

/** Awaits a service call and turns NotFoundError into the 404 page. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}

/** Parses a positive integer route param or shows 404. */
export function intParam(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) notFound();
  return n;
}
