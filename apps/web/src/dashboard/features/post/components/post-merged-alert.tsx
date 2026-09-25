import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@feeblo/ui/alert";
import { buttonVariants } from "@feeblo/ui/button";
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

  const { data: target } = useLiveQuery({
    query: (query) => {
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
  });

  if (!(isMerged && mergedIntoPostId)) {
    return null;
  }

  const targetPost = target?.post;
  const targetBoard = target?.board;

  return (
    <Alert variant="info">
      <HugeiconsIcon icon={GitMergeIcon} />
      <AlertTitle>Post Merged</AlertTitle>
      <AlertDescription>
        {/* A single span keeps the sentence one flex item: the bold target
            title would otherwise become a second flex item and drop to its
            own line. */}
        <span>
          This post was merged into <b>{targetPost?.title ?? "another post"}</b>
        </span>
      </AlertDescription>

      {targetPost && targetBoard ? (
        <AlertAction>
          <Link
            className={buttonVariants({ size: "xs" })}
            params={{
              boardSlug: targetBoard.slug,
              organizationId,
              postSlug: targetPost.slug,
            }}
            to="/$organizationId/post/$boardSlug/$postSlug"
          >
            View post
          </Link>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
