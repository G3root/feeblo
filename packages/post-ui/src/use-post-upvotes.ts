import type { TUpvote } from "@feeblo/domain/upvote/schema";
import type { Collection } from "@tanstack/react-db";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

type UpvoteCollection = Collection<TUpvote, string, any, any>;

/**
 * The full voter list for one post, oldest vote first.
 *
 * The collection is injected because the dashboard and the public board each
 * provide their own; the explicit key keeps the voters dialog from rebuilding
 * the query on every render of its surrounding surface.
 */
export function usePostUpvotes({
  organizationId,
  postId,
  upvoteCollection,
}: {
  organizationId: string;
  postId: string;
  upvoteCollection: UpvoteCollection;
}) {
  return useLiveQuery({
    queryKey: ["post-voter-list", upvoteCollection.id, organizationId, postId],
    query: (q) =>
      q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, postId)
          )
        )
        .orderBy(({ upvote }) => upvote.createdAt, "asc"),
  });
}
