import { Button } from "@feeblo/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@feeblo/ui/popover";
import {
  getReactionEmoji,
  REACTION_EMOJIS,
  type ReactionEmoji,
} from "@feeblo/utils/reaction";
import { SmileIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createContext, type ReactNode, use, useState } from "react";

type ReactionPickerState = {
  disabled: boolean;
  open: boolean;
  selectedReactions: Set<ReactionEmoji>;
};

type ReactionPickerActions = {
  onSelect: (emoji: ReactionEmoji) => void;
  setOpen: (open: boolean) => void;
};

type ReactionPickerMeta = {
  label: string;
};

type ReactionPickerContextValue = {
  actions: ReactionPickerActions;
  meta: ReactionPickerMeta;
  state: ReactionPickerState;
};

const ReactionPickerContext =
  createContext<ReactionPickerContextValue | null>(null);

function useReactionPicker() {
  const value = use(ReactionPickerContext);

  if (!value) {
    throw new Error("ReactionPicker components must be used within Provider.");
  }

  return value;
}

type ReactionPickerProviderProps = {
  children?: ReactNode;
  disabled?: boolean;
  existingReactions?: Set<ReactionEmoji>;
  label?: string;
  onSelect: (emoji: ReactionEmoji) => void;
};

type ReactionPickerRootProps = ReactionPickerProviderProps & {
  children?: never;
};

function ReactionPickerProvider({
  children,
  disabled = false,
  existingReactions,
  label = "Add reaction",
  onSelect,
}: ReactionPickerProviderProps) {
  const [open, setOpen] = useState(false);

  return (
    <ReactionPickerContext
      value={{
        actions: { onSelect, setOpen },
        meta: { label },
        state: {
          disabled,
          open,
          selectedReactions: existingReactions ?? new Set(),
        },
      }}
    >
      <Popover onOpenChange={setOpen} open={open}>
        {children}
      </Popover>
    </ReactionPickerContext>
  );
}

function ReactionPickerTrigger() {
  const { meta, state } = useReactionPicker();

  return (
    <PopoverTrigger
      render={
        <Button
          aria-label={meta.label}
          className="rounded-full"
          disabled={state.disabled}
          size="icon-sm"
          variant="ghost"
        >
          <HugeiconsIcon icon={SmileIcon} />
        </Button>
      }
    />
  );
}

function ReactionPickerGrid() {
  const { actions, state } = useReactionPicker();

  return (
    <PopoverContent className="w-auto p-1" sideOffset={4}>
      <div className="grid grid-cols-4 gap-1">
        {REACTION_EMOJIS.map((emoji) => {
          const isSelected = state.selectedReactions.has(emoji);
          return (
            <Button
              disabled={state.disabled}
              key={emoji}
              onClick={() => {
                actions.setOpen(false);
                actions.onSelect(emoji);
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
  );
}

function ReactionPickerDisplayRow() {
  const { actions, state } = useReactionPicker();

  return (
    <div className="flex flex-row gap-1">
      {REACTION_EMOJIS.map((emoji) => {
        const isSelected = state.selectedReactions.has(emoji);
        return (
          <Button
            disabled={state.disabled}
            key={emoji}
            onClick={() => {
              actions.onSelect(emoji);
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
  );
}

function ReactionPickerComponent(props: ReactionPickerRootProps) {
  return (
    <ReactionPickerProvider {...props}>
      <ReactionPickerTrigger />
      <ReactionPickerGrid />
    </ReactionPickerProvider>
  );
}

export const ReactionPicker = Object.assign(ReactionPickerComponent, {
  Grid: ReactionPickerGrid,
  Provider: ReactionPickerProvider,
  displayRow: ReactionPickerDisplayRow,
  Trigger: ReactionPickerTrigger,
});
