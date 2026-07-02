import { Button } from "@feeblo/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@feeblo/ui/popover";
import {
  getReactionEmoji,
  REACTION_EMOJIS,
  type ReactionEmoji,
} from "@feeblo/utils/reaction";
import { SmileIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

type ReactionPickerProps = {
  disabled?: boolean;
  onSelect: (emoji: ReactionEmoji) => void;
  existingReactions?: Set<ReactionEmoji>;
  label?: string;
};

export function ReactionPicker({
  disabled = false,
  existingReactions,
  onSelect,
  label = "Add reaction",
}: ReactionPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={label}
            className="rounded-full"
            disabled={disabled}
            size="icon-sm"
            variant="ghost"
          >
            <HugeiconsIcon icon={SmileIcon} />
          </Button>
        }
      />
      <PopoverContent className="w-auto p-1" sideOffset={4}>
        <div className="grid grid-cols-4 gap-1">
          {REACTION_EMOJIS.map((emoji) => {
            const isSelected = existingReactions?.has(emoji) ?? false;
            return (
              <Button
                disabled={disabled}
                key={emoji}
                onClick={() => {
                  setOpen(false);
                  onSelect(emoji);
                }}
                size="icon-sm"
                type="button"
                variant={isSelected ? "secondary" : "ghost"}
              >
                {getReactionEmoji(emoji)}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
