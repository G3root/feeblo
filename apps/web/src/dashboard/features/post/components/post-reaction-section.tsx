import { generateId } from "@feeblo/utils/id";
import { SmileIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { toastManager } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { postReactionCollection } from "~/lib/collections";

const REACTION_EMOJIS = ["👍", "❤️", "🔥", "😂", "🎯"] as const;

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
      />
    </div>
  );
}

function ReactionButton({
  isSelected,
  isToggling,
  onToggleReaction,
  reactionCounts,
}: {
  isSelected: (emoji: string) => boolean;
  isToggling: boolean;
  onToggleReaction: (emoji: string) => Promise<void>;
  reactionCounts: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            className="rounded-full"
            disabled={isToggling}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon icon={SmileIcon} />
          </Button>
        }
      />
      <PopoverContent className="w-auto p-2">
        <div className="grid grid-cols-3 gap-2">
          {REACTION_EMOJIS.map((emoji) => {
            return (
              <ReactionPill
                count={reactionCounts[emoji] ?? 0}
                disabled={isToggling}
                emoji={emoji}
                key={emoji}
                onClick={() => {
                  setOpen(false);
                  onToggleReaction(emoji);
                }}
                selected={isSelected(emoji)}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReactionList({
  isSelected,
  isToggling,
  onToggleReaction,
  reactionCounts,
}: {
  isSelected: (emoji: string) => boolean;
  isToggling: boolean;
  onToggleReaction: (emoji: string) => Promise<void>;
  reactionCounts: Record<string, number>;
}) {
  const reactedEmojis = REACTION_EMOJIS.filter(
    (emoji) => (reactionCounts[emoji] ?? 0) > 0
  );

  if (reactedEmojis.length === 0) {
    return null;
  }

  return reactedEmojis.map((emoji) => (
    <ReactionPill
      count={reactionCounts[emoji] ?? 0}
      disabled={isToggling}
      emoji={emoji}
      key={emoji}
      onClick={() => onToggleReaction(emoji)}
      selected={isSelected(emoji)}
    />
  ));
}

function ReactionPill({
  count,
  disabled,
  emoji,
  onClick,
  selected,
}: {
  count: number;
  disabled?: boolean;
  emoji: string;
  onClick?: () => void;
  selected: boolean;
}) {
  return (
    <Button
      className="rounded-full"
      disabled={disabled}
      onClick={onClick}
      size="sm"
      type="button"
      variant={selected ? "secondary" : "ghost"}
    >
      <span>{emoji}</span>
      <span>{count}</span>
    </Button>
  );
}
