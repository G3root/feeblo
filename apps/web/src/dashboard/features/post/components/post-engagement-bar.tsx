import { generateId } from "@feeblo/utils/id";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { postReactionCollection, upvoteCollection } from "~/lib/collections";
import { getPostReactionCollectionKey } from "~/lib/reaction-keys";
import { cn } from "~/lib/utils";
import {
  type PostReaction,
  PostReactionSection,
} from "./post-reaction-section";

export function PostDetailsEngagementBar({
  organizationId,
  postId,
  hasUserUpVoted,
}: {
  organizationId: string;
  postId: string;
  hasUserUpVoted: boolean;
}) {
  const { data: session } = authClient.useSession();
  const { data: upvotes } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, postId)
          )
        ),
    [organizationId, postId]
  );

  const { data: postReactions } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ postReaction: postReactionCollection })
        .where(({ postReaction }) =>
          and(
            eq(postReaction.organizationId, organizationId),
            eq(postReaction.postId, postId)
          )
        )
        .orderBy((postReaction) => postReaction.postReaction.emoji, "asc")
        .orderBy((postReaction) => postReaction.postReaction.createdAt, "asc"),
    [organizationId, postId]
  );

  const handleToggleUpvote = async () => {
    const currentUserId = session?.user?.id;
    if (!currentUserId) {
      toastManager.add({ title: "Sign in to upvote", type: "error" });
      return;
    }

    const memberships = session?.memberships;
    const isMember = memberships?.find(
      (membership) =>
        membership.userId === currentUserId &&
        membership.organizationId === organizationId
    );

    const existingUpvote = upvotes.find(
      (upvote) => upvote.userId === currentUserId
    );

    if (existingUpvote) {
      const tx = upvoteCollection.delete(existingUpvote.id);
      await tx.isPersisted.promise;
      return;
    }

    const tx = upvoteCollection.insert({
      id: generateId("upvote"),
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
    emoji: string,
    existingUserEmojiReaction: PostReaction | undefined
  ) => {
    const currentUserId = session?.user?.id;
    const memberships = session?.memberships;
    if (!currentUserId) {
      toastManager.add({ title: "Sign in to react", type: "error" });
      return;
    }
    const isMember = memberships?.find(
      (membership) =>
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
      id: generateId("postReaction"),
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

  return (
    <>
      <PostReactionSection
        handleToggleReaction={handleToggleReaction}
        postReactions={postReactions}
      />

      <PostUpvoteButton
        handleToggleUpvote={handleToggleUpvote}
        isUpvoted={hasUserUpVoted}
        upvoteCount={upvotes.length}
        variant="default"
      />
    </>
  );
}

export function PostUpvoteButton({
  isUpvoted,
  variant,
  handleToggleUpvote,
  upvoteCount,
}: {
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
        disabled={isToggling}
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
      disabled={isToggling}
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
