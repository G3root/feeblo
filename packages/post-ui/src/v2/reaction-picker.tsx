import { PostReactionId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@feeblo/ui/popover";
import { toastManager } from "@feeblo/ui/toast";
import {
  getReactionEmoji,
  REACTION_EMOJIS,
  type ReactionEmoji,
} from "@feeblo/utils/reaction";
import { getPostReactionCollectionKey } from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { SmileIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, queryOnce } from "@tanstack/react-db";
import { createContext, type ReactNode, use, useState } from "react";
import { usePostCollections } from "./providers/post-collections-provider";

type ReactionPickerState = {
  disabled: boolean;
  open: boolean;
  selectedReactions: Set<ReactionEmoji>;
  reactionList: Map<ReactionEmoji, { count: number }>;
};

type ReactionPickerActions = {
  onToggle: (emoji: ReactionEmoji) => void;
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

const ReactionPickerContext = createContext<ReactionPickerContextValue | null>(
  null
);

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
  onToggle: (emoji: ReactionEmoji) => void;
  reactionList?: Map<ReactionEmoji, { count: number }>;
};

type ReactionPickerRootProps = ReactionPickerProviderProps & {
  children?: never;
};

function ReactionPickerProvider({
  children,
  disabled = false,
  existingReactions,
  label = "Add reaction",
  onToggle,
  reactionList,
}: ReactionPickerProviderProps) {
  const [open, setOpen] = useState(false);

  return (
    <ReactionPickerContext
      value={{
        actions: { onToggle, setOpen },
        meta: { label },
        state: {
          disabled,
          open,
          selectedReactions: existingReactions ?? new Set(),
          reactionList: reactionList ?? new Map(),
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
                actions.onToggle(emoji);
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
      {Array.from(state.reactionList.entries()).map(([emoji, { count }]) => {
        const isSelected = state.selectedReactions.has(emoji);
        return (
          <Button
            className="flex flex-row items-center gap-1"
            disabled={state.disabled}
            key={emoji}
            onClick={() => {
              actions.onToggle(emoji);
            }}
            size="sm"
            type="button"
            variant={isSelected ? "secondary" : "ghost"}
          >
            <span>{getReactionEmoji(emoji)}</span>

            <span className="text-xs">{count}</span>
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

interface PostReactionPickerProps
  extends Omit<ReactionPickerProviderProps, "onToggle"> {
  postId: string;
}

export function PostReactionPicker({
  postId,
  disabled,
  ...rest
}: PostReactionPickerProps) {
  const {
    collections: { postReactionCollection },
    organizationId,
  } = usePostCollections();
  const { data: session } = useAuthState();

  const handleToggleReaction = async (emoji: ReactionEmoji) => {
    if (disabled) {
      return;
    }

    const currentUserId = session?.user?.id;

    if (!currentUserId) {
      toastManager.add({ title: "Sign in to react", type: "error" });
      return;
    }

    const membership = session.memberships.find(
      (value) =>
        value.organizationId === organizationId &&
        value.userId === session.user.id
    );

    const existingUserEmojiReaction = await queryOnce((q) =>
      q
        .from({ post: postReactionCollection })
        .where(({ post }) =>
          and(
            eq(post.emoji, emoji),
            eq(post.organizationId, organizationId),
            eq(post.postId, postId),
            eq(post.userId, currentUserId)
          )
        )
        .findOne()
    );

    if (existingUserEmojiReaction) {
      const tx = postReactionCollection.delete(
        getPostReactionCollectionKey({
          emoji,
          postId,
          userId: currentUserId,
        })
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
      memberId: membership?.membershipId ?? null,
      emoji,
    });
    await tx.isPersisted.promise;
  };

  return (
    <ReactionPickerProvider
      disabled={disabled}
      onToggle={handleToggleReaction}
      {...rest}
    >
      <div className="flex items-center gap-1">
        <ReactionPickerDisplayRow />
        <ReactionPickerTrigger />
      </div>
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
