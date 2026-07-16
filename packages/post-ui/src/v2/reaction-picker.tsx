import { CommentReactionId, PostReactionId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@feeblo/ui/popover";
import { toastManager } from "@feeblo/ui/toast";
import {
  getReactionEmoji,
  REACTION_EMOJIS,
  type ReactionEmoji,
} from "@feeblo/utils/reaction";
import {
  getCommentReactionCollectionKey,
  getPostReactionCollectionKey,
} from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { SmileIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, count, eq, queryOnce, useLiveQuery } from "@tanstack/react-db";
import { createContext, type ReactNode, use, useState } from "react";
import { usePostCollectionData } from "./post-page-context";
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

export function PostReactionPicker() {
  const { isLocked, post, organizationId } = usePostCollectionData();

  const disabled = isLocked;
  const postId = post.id;
  const {
    collections: { postReactionCollection },
    onAuthRequired,
  } = usePostCollections();
  const { data: session } = useAuthState();

  const { data: reactionCounts, isLoading: isReactionCountsLoading } =
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
          .groupBy(({ postReaction }) => postReaction.emoji)
          .select(({ postReaction }) => ({
            emoji: postReaction.emoji,
            count: count(postReaction.id),
          }))
          .orderBy(({ postReaction }) => postReaction.emoji, "asc");
      },
      [organizationId, postId]
    );

  const { data: userReactions, isLoading: isUserReactionsLoading } =
    useLiveQuery(
      (q) => {
        if (!(postId && session?.user?.id)) {
          return undefined;
        }
        return q
          .from({ postReaction: postReactionCollection })
          .where(({ postReaction }) =>
            and(
              eq(postReaction.organizationId, organizationId),
              eq(postReaction.postId, postId),
              eq(postReaction.userId, session.user.id)
            )
          )
          .select(({ postReaction }) => ({
            emoji: postReaction.emoji,
          }))
          .distinct();
      },
      [organizationId, postId, session?.user?.id]
    );

  const handleToggleReaction = async (emoji: ReactionEmoji) => {
    if (disabled) {
      return;
    }

    const currentUserId = session?.user?.id;

    if (!currentUserId) {
      if (onAuthRequired) {
        onAuthRequired();
      } else {
        toastManager.add({ title: "Sign in to react", type: "error" });
      }
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

  const isLoading = isUserReactionsLoading || isReactionCountsLoading;

  if (isLoading) {
    return null;
  }

  const existingReactions = new Set(
    (userReactions ?? []).map((r) => r.emoji as ReactionEmoji)
  );

  const reactionList = new Map(
    (reactionCounts ?? []).map((r) => [
      r.emoji as ReactionEmoji,
      { count: r.count },
    ])
  );

  return (
    <ReactionPickerProvider
      disabled={disabled}
      existingReactions={existingReactions}
      onToggle={handleToggleReaction}
      reactionList={reactionList}
    >
      <div className="flex items-center gap-1">
        <ReactionPickerDisplayRow />
        <ReactionPickerTrigger />
      </div>
      <ReactionPickerGrid />
    </ReactionPickerProvider>
  );
}

interface CommentReactionPickerProps {
  commentId: string;
  disabled?: boolean;
  postId: string;
}

export function CommentReactionPicker({
  commentId,
  disabled,
  postId,
}: CommentReactionPickerProps) {
  const {
    collections: { commentReactionCollection },
    onAuthRequired,
    organizationId,
  } = usePostCollections();
  const { data: session } = useAuthState();

  const { data: reactionCounts, isLoading: isReactionCountsLoading } =
    useLiveQuery(
      (q) => {
        if (!postId) {
          return undefined;
        }
        return q
          .from({ commentReaction: commentReactionCollection })
          .where(({ commentReaction }) =>
            and(
              eq(commentReaction.commentId, commentId),
              eq(commentReaction.postId, postId)
            )
          )
          .groupBy(({ commentReaction }) => commentReaction.emoji)
          .select(({ commentReaction }) => ({
            emoji: commentReaction.emoji,
            count: count(commentReaction.id),
          }))
          .orderBy(({ commentReaction }) => commentReaction.emoji, "asc");
      },
      [organizationId, postId]
    );

  const { data: userReactions, isLoading: isUserReactionsLoading } =
    useLiveQuery(
      (q) => {
        if (!(postId && session?.user?.id)) {
          return undefined;
        }
        return q
          .from({ commentReaction: commentReactionCollection })
          .where(({ commentReaction }) =>
            and(
              eq(commentReaction.commentId, commentId),
              eq(commentReaction.userId, session.user.id),
              eq(commentReaction.postId, postId)
            )
          )
          .select(({ commentReaction }) => ({
            emoji: commentReaction.emoji,
          }))
          .distinct();
      },
      [organizationId, postId, session?.user?.id]
    );

  const handleToggleReaction = async (emoji: ReactionEmoji) => {
    if (disabled) {
      return;
    }

    const currentUserId = session?.user?.id;

    if (!currentUserId) {
      if (onAuthRequired) {
        onAuthRequired();
      } else {
        toastManager.add({ title: "Sign in to react", type: "error" });
      }
      return;
    }

    const membership = session.memberships.find(
      (value) =>
        value.organizationId === organizationId &&
        value.userId === session.user.id
    );

    const existingUserEmojiReaction = await queryOnce((q) =>
      q
        .from({ reaction: commentReactionCollection })
        .where(({ reaction }) =>
          and(
            eq(reaction.emoji, emoji),
            eq(reaction.organizationId, organizationId),
            eq(reaction.commentId, commentId),
            eq(reaction.userId, currentUserId)
          )
        )
        .findOne()
    );

    if (existingUserEmojiReaction) {
      const tx = commentReactionCollection.delete(
        getCommentReactionCollectionKey({
          emoji,
          userId: currentUserId,
          commentId,
        })
      );
      await tx.isPersisted.promise;
      return;
    }
    const tx = commentReactionCollection.insert({
      id: await CommentReactionId.unsafeGenerate(),
      createdAt: new Date(),
      updatedAt: new Date(),
      organizationId,
      postId,
      userId: currentUserId,
      memberId: membership?.membershipId ?? null,
      emoji,
      commentId,
    });
    await tx.isPersisted.promise;
  };

  const isLoading = isReactionCountsLoading || isUserReactionsLoading;

  if (isLoading) {
    return null;
  }

  const existingReactions = new Set(
    (userReactions ?? []).map((r) => r.emoji as ReactionEmoji)
  );

  const reactionList = new Map(
    (reactionCounts ?? []).map((r) => [
      r.emoji as ReactionEmoji,
      { count: r.count },
    ])
  );

  return (
    <ReactionPickerProvider
      disabled={disabled}
      existingReactions={existingReactions}
      onToggle={handleToggleReaction}
      reactionList={reactionList}
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
