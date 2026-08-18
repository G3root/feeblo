import type {
  PostActivityActor,
  PostActivityInput,
} from "../post-activity/repository";

/**
 * Derives `TAG_ADDED` / `TAG_REMOVED` activity inputs from the previous and
 * next tag sets of a post. Pure domain calculation; the handler only orders
 * it inside the persistence transaction.
 */
export function postTagChangeActivities({
  previousTagIds,
  nextTagIds,
  actor,
}: {
  readonly previousTagIds: readonly string[];
  readonly nextTagIds: readonly string[];
  readonly actor: PostActivityActor;
}): readonly PostActivityInput[] {
  const next = new Set(nextTagIds);
  const added = nextTagIds.filter((tagId) => !previousTagIds.includes(tagId));
  const removed = previousTagIds.filter((tagId) => !next.has(tagId));

  return [
    ...added.map(
      (tagId): PostActivityInput => ({ ...actor, kind: "TAG_ADDED", tagId })
    ),
    ...removed.map(
      (tagId): PostActivityInput => ({ ...actor, kind: "TAG_REMOVED", tagId })
    ),
  ];
}
