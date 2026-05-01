import { createContext, type ReactNode, use, useMemo, useState } from "react";
import { toastManager } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { ReactionButton, ReactionList } from "./reaction-button";

export type CommentReaction = {
  id: string;
  commentId: string;
  postId: string;
  organizationId: string;
  userId: string;
  emoji: string;
};

export type CommentReactionToggleInput = {
  commentId: string;
  emoji: string;
  existingReaction?: CommentReaction;
  organizationId: string;
  postId: string;
  userId: string;
};

type CommentReactionSectionProps = {
  commentId: string;
  commentReactions: CommentReaction[];
  disabled?: boolean;
  handleToggleReaction: (value: CommentReactionToggleInput) => Promise<void>;
  organizationId: string;
  postId: string;
};

type CommentReactionRootProps = CommentReactionSectionProps & {
  children: ReactNode;
};

type CommentReactionContextValue = {
  commentId: string;
  currentUserId?: string;
  disabled: boolean;
  handleToggleReaction: (emoji: string) => Promise<void>;
  isSelected: (emoji: string) => boolean;
  isToggling: boolean;
  reactionCounts: Record<string, number>;
};

const CommentReactionContext =
  createContext<CommentReactionContextValue | null>(null);

function useCommentReactionSection() {
  const value = use(CommentReactionContext);

  if (!value) {
    throw new Error(
      "CommentReactionSection components must be used within Root."
    );
  }

  return value;
}

function CommentReactionRoot({
  children,
  commentId,
  commentReactions,
  disabled = false,
  handleToggleReaction: handleToggleReaction_,
  organizationId,
  postId,
}: CommentReactionRootProps) {
  const { data: session } = authClient.useSession();
  const [isToggling, setIsToggling] = useState(false);
  const currentUserId = session?.user?.id;

  const reactionsForComment = useMemo(
    () =>
      commentReactions.filter((reaction) => reaction.commentId === commentId),
    [commentId, commentReactions]
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
  }, [currentUserId, reactionsForComment]);

  const handleToggleReaction = async (emoji: string) => {
    if (disabled) {
      toastManager.add({
        title: "This post is locked",
        type: "error",
      });
      return;
    }

    if (!currentUserId) {
      toastManager.add({ title: "Sign in to react", type: "error" });
      return;
    }

    try {
      setIsToggling(true);

      const existingReaction = reactionsForComment.find(
        (reaction) =>
          reaction.userId === currentUserId && reaction.emoji === emoji
      );

      await handleToggleReaction_({
        commentId,
        emoji,
        existingReaction,
        organizationId,
        postId,
        userId: currentUserId,
      });
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
    <CommentReactionContext
      value={{
        commentId,
        currentUserId,
        disabled,
        handleToggleReaction,
        isSelected: (emoji) => userReactionSet.has(emoji),
        isToggling,
        reactionCounts,
      }}
    >
      {children}
    </CommentReactionContext>
  );
}

function CommentReactionContent({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

function CommentReactionListContent() {
  const { disabled, handleToggleReaction, isSelected, isToggling, reactionCounts } =
    useCommentReactionSection();

  return (
    <ReactionList
      disabled={disabled}
      isSelected={isSelected}
      isToggling={isToggling}
      onToggleReaction={handleToggleReaction}
      reactionCounts={reactionCounts}
    />
  );
}

function CommentReactionButtonContent() {
  const { disabled, handleToggleReaction, isSelected, isToggling, reactionCounts } =
    useCommentReactionSection();

  return (
    <ReactionButton
      disabled={disabled}
      isSelected={isSelected}
      isToggling={isToggling}
      onToggleReaction={handleToggleReaction}
      reactionCounts={reactionCounts}
      showCount={false}
    />
  );
}

function CommentReactionSectionComponent(props: CommentReactionSectionProps) {
  return (
    <CommentReactionRoot {...props}>
      <CommentReactionContent>
        <CommentReactionListContent />
        <CommentReactionButtonContent />
      </CommentReactionContent>
    </CommentReactionRoot>
  );
}

export const CommentReactionSection = Object.assign(
  CommentReactionSectionComponent,
  {
    Button: CommentReactionButtonContent,
    Content: CommentReactionContent,
    List: CommentReactionListContent,
    Root: CommentReactionRoot,
  }
);
