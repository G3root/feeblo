import { type ReactNode, useMemo } from "react";

import {
  CommentDisplayContext,
  type CommentDisplayContextValue,
} from "./context";

export type CommentDisplayProviderProps = {
  children?: ReactNode;
  authorName: string;
  commentId: string;
  postId: string;
  postSlug: string;
  content: string;
  createdAt: Date;
  deleteLabel?: string;
  disabled?: boolean;
  editLabel?: string;
  isAuthor?: boolean;
  isEditing?: boolean;
  isInternal?: boolean;
  onCancelEdit?: () => void;
  onDelete: () => void;
  onReply: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  onStartEdit?: () => void;
  onToggleVisibility?: () => void;
  onUpdate?: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  replyLabel?: string;
  toggleToInternalLabel?: string;
  toggleToPublicLabel?: string;
};

const noop = () => undefined;

const defaultCallbacks = {
  onCancelEdit: noop,
  onStartEdit: noop,
  onToggleVisibility: noop,
  onUpdate: noop,
};

export function CommentDisplayProvider({
  children,
  authorName,
  commentId,
  postId,
  postSlug,
  content,
  createdAt,
  deleteLabel = "Delete",
  disabled = false,
  editLabel = "Edit",
  isAuthor = false,
  isEditing = false,
  isInternal = false,
  onCancelEdit = defaultCallbacks.onCancelEdit,
  onDelete,
  onReply,
  onStartEdit = defaultCallbacks.onStartEdit,
  onToggleVisibility = defaultCallbacks.onToggleVisibility,
  onUpdate = defaultCallbacks.onUpdate,
  replyLabel = "Reply",
  toggleToInternalLabel = "Make internal",
  toggleToPublicLabel = "Make public",
}: CommentDisplayProviderProps) {
  const contextValue = useMemo<CommentDisplayContextValue>(
    () => ({
      actions: {
        onCancelEdit,
        onDelete,
        onReply,
        onStartEdit,
        onToggleVisibility,
        onUpdate,
      },
      meta: {
        deleteLabel,
        editLabel,
        replyLabel,
        toggleToInternalLabel,
        toggleToPublicLabel,
      },
      state: {
        authorName,
        commentId,
        content,
        createdAt,
        disabled,
        isAuthor,
        isEditing,
        isInternal,
        postId,
        postSlug,
      },
    }),
    [
      authorName,
      commentId,
      content,
      createdAt,
      deleteLabel,
      disabled,
      editLabel,
      isAuthor,
      isEditing,
      isInternal,
      onCancelEdit,
      onDelete,
      onReply,
      onStartEdit,
      onToggleVisibility,
      onUpdate,
      postId,
      postSlug,
      replyLabel,
      toggleToInternalLabel,
      toggleToPublicLabel,
    ]
  );

  return (
    <CommentDisplayContext value={contextValue}>
      {children}
    </CommentDisplayContext>
  );
}
