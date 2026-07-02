import { PostReactionId } from "@feeblo/id";
import { Skeleton } from "@feeblo/ui/skeleton";
import { toastManager } from "@feeblo/ui/toast";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { useDashboardCollections } from "@feeblo/web-shared/dashboard-collections-provider";
import { getPostReactionCollectionKey } from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { usePostCollections } from "../v2/providers/post-collections-provider";
import { UpvoteButton } from "../v2/upvote-toggle";
import {
  type PostReaction,
  PostReactionSection,
} from "./post-reaction-section";

type SessionMembership = {
  membershipId: string;
  organizationId: string;
  userId: string;
};

export function PostDetailsEngagementBar({
  disabled = false,
  organizationId,
  postId,
}: {
  disabled?: boolean;
  organizationId: string;
  postId: string;
}) {
  const { postReactionCollection } = useDashboardCollections();

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

  const { data: postReactions, isLoading: isPostReactionsLoading } =
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
          .orderBy((postReaction) => postReaction.postReaction.emoji, "asc")
          .orderBy(
            (postReaction) => postReaction.postReaction.createdAt,
            "asc"
          );
      },
      [organizationId, postId]
    );

  const hasCurrentUserUpvoted =
    session?.user?.id != null
      ? upvotes?.some((upvote) => upvote.userId === session.user.id)
      : false;

  const handleToggleReaction = async (
    emoji: ReactionEmoji,
    existingUserEmojiReaction: PostReaction | undefined
  ) => {
    if (disabled) {
      return;
    }

    const currentUserId = session?.user?.id;
    const memberships = (
      session as { memberships?: SessionMembership[] } | null
    )?.memberships;
    if (!currentUserId) {
      toastManager.add({ title: "Sign in to react", type: "error" });
      return;
    }
    const isMember = memberships?.find(
      (membership: SessionMembership) =>
        membership.userId === currentUserId &&
        membership.organizationId === organizationId
    );

    if (existingUserEmojiReaction) {
      const tx = postReactionCollection.delete(
        getPostReactionCollectionKey(existingUserEmojiReaction)
      );
      await tx.isPersisted.promise;
      return;
    }
    const tx = postReactionCollection.insert({
      id: await PostReactionId.unsafeGenerate(),
      createdAt: new Date(),
      updatedAt: new Date(),
      organizationId,
      postId,
      userId: currentUserId,
      memberId: isMember ? isMember.membershipId : null,
      emoji,
    });
    await tx.isPersisted.promise;
  };

  const isLoading = isUpvotesLoading || isPostReactionsLoading;

  if (isLoading) {
    return <PostDetailsEngagementBarSkeleton />;
  }

  return (
    <>
      <PostReactionSection
        disabled={disabled}
        handleToggleReaction={handleToggleReaction}
        postReactions={postReactions ?? []}
      />

      <UpvoteButton
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
