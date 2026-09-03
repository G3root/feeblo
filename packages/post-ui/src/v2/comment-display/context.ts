import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
import { createContext, use } from "react";

export type CommentDisplayState = {
  authorName: string;
  commentId: string;
  postId: string;
  postSlug: string;
  content: string;
  createdAt: Date;
  disabled: boolean;
  isAuthor: boolean;
  isEditing: boolean;
  isInternal: boolean;
  pinnedAt: Date | null;
  /** Post status moved by this comment, when posted as a status update. */
  statusUpdateType: TPostStatusType | null;
  /** Status row label for the status update, when the org set a custom one. */
  statusUpdateLabel: string | null;
  /** Status row color (oklch string) for the status update, when set. */
  statusUpdateColor: string | null;
};

export type CommentDisplayActions = {
  onCancelEdit: () => void;
  onDelete: () => void;
  onReply: (value: {
    content: string;
    isPrivate: boolean;
  }) => boolean | Promise<boolean>;
  onStartEdit: () => void;
  onToggleVisibility: () => void;
  onTogglePin: () => void;
  onUpdate: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
};

export type CommentDisplayMeta = {
  deleteLabel: string;
  editLabel: string;
  replyLabel: string;
  toggleToInternalLabel: string;
  toggleToPublicLabel: string;
  pinLabel: string;
  unpinLabel: string;
};

export type CommentDisplayContextValue = {
  actions: CommentDisplayActions;
  meta: CommentDisplayMeta;
  state: CommentDisplayState;
};

export const CommentDisplayContext =
  createContext<CommentDisplayContextValue | null>(null);

export function useCommentDisplay() {
  const value = use(CommentDisplayContext);

  if (!value) {
    throw new Error("CommentDisplay components must be used within Provider.");
  }

  return value;
}
