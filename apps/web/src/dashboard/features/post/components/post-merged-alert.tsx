import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { GitMergeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * Explains the tombstone on a merged post and links to the survivor.
 *
 * The merge hides the source from public surfaces and archives it, so without
 * this banner the dashboard detail page looks like an ordinary archived post
 * with no way to reach the discussion now happening on the target.
 */
export function PostMergedAlert() {
  const { isMerged, organizationId, post } = usePostCollectionData();
  const { boardCollection, postCollection } = useDashboardCollections();
  const mergedIntoPostId = post.mergedIntoPostId;

  const { data: target } = useLiveQuery(
    (query) => {
      if (!mergedIntoPostId) {
        return undefined;
      }
      return query
        .from({ post: postCollection })
        .join(
          { board: boardCollection },
          ({ board, post: targetPost }) => eq(targetPost.boardId, board.id),
          "inner"
        )
        .where(({ post: targetPost }) =>
          and(
            eq(targetPost.id, mergedIntoPostId),
            eq(targetPost.organizationId, organizationId)
          )
        )
        .findOne();
    },
    [boardCollection, mergedIntoPostId, organizationId, postCollection]
  );

  if (!(isMerged && mergedIntoPostId)) {
    return null;
  }

  const targetPost = target?.post;
  const targetBoard = target?.board;

  return (
    <Alert variant="info">
      <HugeiconsIcon icon={GitMergeIcon} />
      <AlertTitle>Merged post</AlertTitle>
      <AlertDescription>
        This post was merged into{" "}
        {targetPost && targetBoard ? (
          <Link
            className="font-medium underline underline-offset-4"
            params={{
              boardSlug: targetBoard.slug,
              organizationId,
              postSlug: targetPost.slug,
            }}
            to="/$organizationId/post/$boardSlug/$postSlug"
          >
            {targetPost.title}
          </Link>
        ) : (
          "another post"
        )}
        . Comments, votes, reactions, and followers live on the surviving post.
      </AlertDescription>
    </Alert>
  );
}
