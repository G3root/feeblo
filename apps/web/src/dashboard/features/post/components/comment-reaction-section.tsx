import { generateId } from "@feeblo/utils/id";
import { useMemo, useState } from "react";
import { toastManager } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { commentReactionCollection } from "~/lib/collections";
import { ReactionButton, ReactionList } from "./reaction-button";

export type CommentReaction = {
  id: string;
  commentId: string;
  postId: string;
  organizationId: string;
  userId: string;
  emoji: string;
};

export function CommentReactionSection({
  commentId,
  commentReactions,
  organizationId,
  postId,
}: {
  commentId: string;
  commentReactions: CommentReaction[];
  organizationId: string;
  postId: string;
}) {
  const { data: session } = authClient.useSession();
  const [isToggling, setIsToggling] = useState(false);
  const currentUserId = session?.user?.id;

  const reactionsForComment = useMemo(
    () =>
      commentReactions.filter((reaction) => reaction.commentId === commentId),
    [commentReactions, commentId]
  );

  const reactionCounts = useMemo(() => {
    return reactionsForComment.reduce(
      (acc, reaction) => {
        acc[reaction.emoji] = (acc[reaction.emoji] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [reactionsForComment]);

  const userReactionSet = useMemo(() => {
    if (!currentUserId) {
      return new Set<string>();
    }

    return new Set(
      reactionsForComment
        .filter((reaction) => reaction.userId === currentUserId)
        .map((reaction) => reaction.emoji)
    );
  }, [reactionsForComment, currentUserId]);

  const handleToggleReaction = async (emoji: string) => {
    if (!currentUserId) {
      toastManager.add({ title: "Sign in to react", type: "error" });
      return;
    }

    try {
      setIsToggling(true);

      const existingUserEmojiReaction = reactionsForComment.find(
        (reaction) =>
          reaction.userId === currentUserId && reaction.emoji === emoji
      );

      if (existingUserEmojiReaction) {
        const tx = commentReactionCollection.delete(
          existingUserEmojiReaction.id
        );
        await tx.isPersisted.promise;
        return;
      }

      const tx = commentReactionCollection.insert({
        id: generateId("commentReaction"),
        commentId,
        postId,
        organizationId,
        userId: currentUserId,
        memberId: null,
        emoji,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await tx.isPersisted.promise;
    } catch (_error) {
      toastManager.add({
        title: "Failed to update comment reaction",
        type: "error",
      });
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <ReactionList
        isSelected={(emoji) => userReactionSet.has(emoji)}
        isToggling={isToggling}
        onToggleReaction={handleToggleReaction}
        reactionCounts={reactionCounts}
      />
      <ReactionButton
        isSelected={(emoji) => userReactionSet.has(emoji)}
        isToggling={isToggling}
        onToggleReaction={handleToggleReaction}
        reactionCounts={reactionCounts}
        showCount={false}
      />
    </div>
  );
}
