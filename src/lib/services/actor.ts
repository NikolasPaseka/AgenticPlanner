import type { Actor as TransitionActor } from "@/lib/domain/tasks";

/** Who performs an action. `name` is a GitHub login, an agent role, or "system". */
export type Actor = { kind: TransitionActor; name: string };

/** Maps an actor to the `actor_type` column value. */
export function actorColumn(actor: Actor): "user" | "agent" | "system" {
  return actor.kind === "owner" ? "user" : actor.kind;
}
