import { useMemo, useState } from "react";
import { toastManager } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { ReactionButton, ReactionList } from "./reaction-button";

export type PostReaction = {
  id: string;
  organizationId: string;
  postId: string;
  userId: string;
  emoji: string;
};

export function PostReactionSection({
  disabled = false,
  handleToggleReaction: handleToggleReaction_,
  postReactions,
}: {
  disabled?: boolean;
  handleToggleReaction: (
    emoji: string,
    existingUserEmojiReaction: PostReaction | undefined
  ) => Promise<void>;
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
    if (disabled) {
      return;
    }

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

      await handleToggleReaction_(emoji, existingUserEmojiReaction);
    } catch (_error) {
      toastManager.add({ title: "Failed to update reaction", type: "error" });
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <ReactionList
        disabled={disabled}
        isSelected={(emoji) => userReactionSet.has(emoji)}
        isToggling={isToggling}
        onToggleReaction={handleToggleReaction}
        reactionCounts={reactionCounts}
      />
      <ReactionButton
        disabled={disabled}
        isSelected={(emoji) => userReactionSet.has(emoji)}
        isToggling={isToggling}
        onToggleReaction={handleToggleReaction}
        reactionCounts={reactionCounts}
        showCount={false}
      />
    </div>
  );
}
