import { PostReactionId, UpvoteId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { Skeleton } from "@feeblo/ui/skeleton";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { useDashboardCollections } from "@feeblo/web-shared/dashboard-collections-provider";
import {
  getPostReactionCollectionKey,
  getUpvoteCollectionKey,
} from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
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
  const { postReactionCollection, upvoteCollection } =
    useDashboardCollections();
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

  const handleToggleUpvote = async () => {
    if (disabled || !upvotes) {
      return;
    }

    const currentUserId = session?.user?.id;
    if (!currentUserId) {
      toastManager.add({ title: "Sign in to upvote", type: "error" });
      return;
    }

    const memberships = (
      session as { memberships?: SessionMembership[] } | null
    )?.memberships;
    const isMember = memberships?.find(
      (membership: SessionMembership) =>
        membership.userId === currentUserId &&
        membership.organizationId === organizationId
    );

    const existingUpvote = upvotes.find(
      (upvote) => upvote.userId === currentUserId
    );

    if (existingUpvote) {
      const tx = upvoteCollection.delete(
        getUpvoteCollectionKey(existingUpvote)
      );
      await tx.isPersisted.promise;
      return;
    }

    const tx = upvoteCollection.insert({
      id: await UpvoteId.unsafeGenerate(),
      createdAt: new Date(),
      updatedAt: new Date(),
      organizationId,
      postId,
      userId: currentUserId,
      memberId: isMember ? isMember.membershipId : null,
      user: {
        name: session?.user?.name ?? null,
        image: session?.user?.image ?? null,
      },
    });
    await tx.isPersisted.promise;
  };
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

      <PostUpvoteButton
        disabled={disabled}
        handleToggleUpvote={handleToggleUpvote}
        isUpvoted={hasCurrentUserUpvoted ?? false}
        upvoteCount={upvotes?.length ?? 0}
        variant="default"
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

export function PostUpvoteButton({
  disabled = false,
  isUpvoted,
  variant,
  handleToggleUpvote,
  upvoteCount,
}: {
  disabled?: boolean;
  isUpvoted: boolean;
  variant: "compact" | "default";
  handleToggleUpvote: () => Promise<void> | void;
  upvoteCount: number;
}) {
  const [isToggling, setIsToggling] = useState(false);

  const handleToggleUpvote_ = async () => {
    try {
      setIsToggling(true);
      await handleToggleUpvote();
    } catch (_error) {
      toastManager.add({ title: "Failed to update upvote", type: "error" });
    } finally {
      setIsToggling(false);
    }
  };

  if (variant === "compact") {
    return (
      <button
        className={cn(
          "flex h-9 w-10 shrink-0 flex-col items-center justify-center rounded-md text-xs transition-colors",
          isUpvoted
            ? "bg-primary/10 text-primary"
            : "bg-muted/70 text-muted-foreground hover:bg-muted"
        )}
        disabled={disabled || isToggling}
        onClick={handleToggleUpvote_}
        type="button"
      >
        <HugeiconsIcon className="size-3" icon={ArrowUp01Icon} />
        <span className="font-medium text-xs tabular-nums leading-none">
          {upvoteCount}
        </span>
      </button>
    );
  }

  return (
    <Button
      className="rounded-full"
      disabled={disabled || isToggling}
      onClick={handleToggleUpvote_}
      size="sm"
      type="button"
      variant={isUpvoted ? "default" : "outline"}
    >
      <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
      <span>{upvoteCount}</span>
    </Button>
  );
}
