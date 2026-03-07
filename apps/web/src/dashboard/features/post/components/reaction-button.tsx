import { SmileIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

const REACTION_EMOJIS = ["👍", "❤️", "🔥", "😂", "🎯"] as const;

type ReactionButtonProps = {
  isSelected: (emoji: string) => boolean;
  isToggling: boolean;
  onToggleReaction: (emoji: string) => Promise<void>;
  reactionCounts: Record<string, number>;
  showCount?: boolean;
};

type ReactionListProps = {
  isSelected: (emoji: string) => boolean;
  isToggling: boolean;
  onToggleReaction: (emoji: string) => Promise<void>;
  reactionCounts: Record<string, number>;
};

export function ReactionButton({
  isSelected,
  isToggling,
  onToggleReaction,
  reactionCounts,
  showCount = true,
}: ReactionButtonProps) {
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
          {REACTION_EMOJIS.map((emoji) => (
            <ReactionPill
              count={reactionCounts[emoji] ?? 0}
              disabled={isToggling}
              emoji={emoji}
              key={emoji}
              onClick={() => {
                setOpen(false);
                void onToggleReaction(emoji);
              }}
              selected={isSelected(emoji)}
              showCount={showCount}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ReactionList({
  isSelected,
  isToggling,
  onToggleReaction,
  reactionCounts,
}: ReactionListProps) {
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
      onClick={() => {
        onToggleReaction(emoji);
      }}
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
  showCount = true,
}: {
  count: number;
  disabled?: boolean;
  emoji: string;
  onClick?: () => void;
  selected: boolean;
  showCount?: boolean;
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
      {showCount && <span>{count}</span>}
    </Button>
  );
}
