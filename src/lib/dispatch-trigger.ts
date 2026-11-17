import { after } from "next/server";
import { getDb } from "@/lib/db";
import { githubConfigured } from "@/lib/github/config";
import { getGitHub } from "@/lib/github/gateway";
import { dispatchAll } from "@/lib/services/dispatch";

/**
 * Runs the dispatcher after the current response is sent. Called after any change
 * that could start work: new Todo tasks, released holds, finished runs, agents on.
 */
export function scheduleDispatch() {
  if (!githubConfigured()) return;
  after(async () => {
    try {
      await dispatchAll(getDb(), getGitHub());
    } catch (e) {
      console.error("dispatch failed", e);
    }
  });
}
