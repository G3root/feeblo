import { generateId } from "@feeblo/utils/id";
import { useMemo, useState } from "react";
import { toastManager } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { postReactionCollection } from "~/lib/collections";
import { ReactionButton, ReactionList } from "./reaction-button";

export type PostReaction = {
  id: string;
  organizationId: string;
  postId: string;
  userId: string;
  emoji: string;
};

export function PostReactionSection({
  organizationId,
  postId,
  postReactions,
}: {
  organizationId: string;
  postId: string;
  postReactions: PostReaction[];
}) {
  const { data: session } = authClient.useSession();
  const [isToggling, setIsToggling] = useState(false);
  const currentUserId = session?.user?.id;

  const reactionCounts = useMemo(() => {
    return postReactions.reduce(
      (acc, reaction) => {
        acc[reaction.emoji] = (acc[reaction.emoji] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [postReactions]);

  const userReactionSet = useMemo(() => {
    if (!currentUserId) {
      return new Set<string>();
    }

    return new Set(
      postReactions
        .filter((reaction) => reaction.userId === currentUserId)
        .map((reaction) => reaction.emoji)
    );
  }, [postReactions, currentUserId]);

  const handleToggleReaction = async (emoji: string) => {
    if (!currentUserId) {
      toastManager.add({ title: "Sign in to react", type: "error" });
      return;
    }

    try {
      setIsToggling(true);

      const existingUserEmojiReaction = postReactions.find(
        (reaction) =>
          reaction.userId === currentUserId && reaction.emoji === emoji
      );

      if (existingUserEmojiReaction) {
        const tx = postReactionCollection.delete(existingUserEmojiReaction.id);
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
        memberId: null,
        emoji,
      });
      await tx.isPersisted.promise;
    } catch (_error) {
      toastManager.add({ title: "Failed to update reaction", type: "error" });
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
