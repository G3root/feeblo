import { Skeleton } from "@feeblo/ui/skeleton";
import type { ReactionEmoji } from "@feeblo/utils/reaction";

import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { and, count, eq, useLiveQuery } from "@tanstack/react-db";
import { usePostCollections } from "../v2/providers/post-collections-provider";
import { PostReactionPicker } from "../v2/reaction-picker";
import { UpvoteButton } from "../v2/upvote-toggle";

export function PostDetailsEngagementBar({
  disabled = false,
  organizationId,
  postId,
}: {
  disabled?: boolean;
  organizationId: string;
  postId: string;
}) {
  const {
    collections: { postReactionCollection },
  } = usePostCollections();

  const {
    collections: { upvoteCollection },
  } = usePostCollections();
  const { data: session } = useAuthState();
  const { data: upvotes, isLoading: isUpvotesLoading } = useLiveQuery(
    (q) => {
      if (!postId) {
        return undefined;
      }
      return q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, postId)
          )
        );
    },
    [organizationId, postId]
  );

  const { data: reactionCounts, isLoading: isReactionCountsLoading } =
    useLiveQuery(
      (q) => {
        if (!postId) {
          return undefined;
        }
        return q
          .from({ postReaction: postReactionCollection })
          .where(({ postReaction }) =>
            and(
              eq(postReaction.organizationId, organizationId),
              eq(postReaction.postId, postId)
            )
          )
          .groupBy(({ postReaction }) => postReaction.emoji)
          .select(({ postReaction }) => ({
            emoji: postReaction.emoji,
            count: count(postReaction.id),
          }))
          .orderBy(({ postReaction }) => postReaction.emoji, "asc");
      },
      [organizationId, postId]
    );

  const { data: userReactions, isLoading: isUserReactionsLoading } =
    useLiveQuery(
      (q) => {
        if (!(postId && session?.user?.id)) {
          return undefined;
        }
        return q
          .from({ postReaction: postReactionCollection })
          .where(({ postReaction }) =>
            and(
              eq(postReaction.organizationId, organizationId),
              eq(postReaction.postId, postId),
              eq(postReaction.userId, session.user.id)
            )
          )
          .select(({ postReaction }) => ({
            emoji: postReaction.emoji,
          }))
          .distinct();
      },
      [organizationId, postId, session?.user?.id]
    );

  const hasCurrentUserUpvoted =
    session?.user?.id != null
      ? upvotes?.some((upvote) => upvote.userId === session.user.id)
      : false;

  const isLoading =
    isUpvotesLoading || isReactionCountsLoading || isUserReactionsLoading;

  const existingReactions = new Set(
    (userReactions ?? []).map((r) => r.emoji as ReactionEmoji)
  );

  const reactionList = new Map(
    (reactionCounts ?? []).map((r) => [
      r.emoji as ReactionEmoji,
      { count: r.count },
    ])
  );

  if (isLoading) {
    return <PostDetailsEngagementBarSkeleton />;
  }

  return (
    <>
      <PostReactionPicker
        disabled={disabled}
        existingReactions={existingReactions}
        postId={postId}
        reactionList={reactionList}
      />

      <UpvoteButton
        disabled={disabled}
        isUpvoted={!!hasCurrentUserUpvoted}
        postId={postId}
        upvoteCount={upvotes?.length ?? 0}
      />
    </>
  );
}

export function PostDetailsEngagementBarSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="h-8 w-16 rounded-full" />
      <Skeleton className="h-8 w-20 rounded-full" />
      <Skeleton className="h-8 w-24 rounded-full" />
      <Skeleton className="h-8 w-16 rounded-full" />
    </div>
  );
}
