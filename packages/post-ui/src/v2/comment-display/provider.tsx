import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
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
  pinnedAt?: Date | null;
  statusUpdateType?: TPostStatusType | null;
  statusUpdateColor?: string | null;
  statusUpdateLabel?: string | null;
  onCancelEdit?: () => void;
  onDelete: () => void;
  onReply: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  onStartEdit?: () => void;
  onToggleVisibility?: () => void;
  onTogglePin?: () => void;
  onUpdate?: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  replyLabel?: string;
  toggleToInternalLabel?: string;
  toggleToPublicLabel?: string;
  pinLabel?: string;
  unpinLabel?: string;
};

const noop = () => undefined;

const defaultCallbacks = {
  onCancelEdit: noop,
  onStartEdit: noop,
  onToggleVisibility: noop,
  onTogglePin: noop,
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
  pinnedAt = null,
  statusUpdateType = null,
  statusUpdateColor = null,
  statusUpdateLabel = null,
  onCancelEdit = defaultCallbacks.onCancelEdit,
  onDelete,
  onReply,
  onStartEdit = defaultCallbacks.onStartEdit,
  onToggleVisibility = defaultCallbacks.onToggleVisibility,
  onTogglePin = defaultCallbacks.onTogglePin,
  onUpdate = defaultCallbacks.onUpdate,
  replyLabel = "Reply",
  toggleToInternalLabel = "Make internal",
  toggleToPublicLabel = "Make public",
  pinLabel = "Pin comment",
  unpinLabel = "Unpin comment",
}: CommentDisplayProviderProps) {
  const contextValue = useMemo<CommentDisplayContextValue>(
    () => ({
      actions: {
        onCancelEdit,
        onDelete,
        onReply,
        onStartEdit,
        onToggleVisibility,
        onTogglePin,
        onUpdate,
      },
      meta: {
        deleteLabel,
        editLabel,
        replyLabel,
        toggleToInternalLabel,
        toggleToPublicLabel,
        pinLabel,
        unpinLabel,
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
        pinnedAt,
        postId,
        postSlug,
        statusUpdateType,
        statusUpdateColor,
        statusUpdateLabel,
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
      pinnedAt,
      onCancelEdit,
      onDelete,
      onReply,
      onStartEdit,
      onToggleVisibility,
      onTogglePin,
      onUpdate,
      postId,
      postSlug,
      replyLabel,
      statusUpdateType,
      statusUpdateColor,
      statusUpdateLabel,
      toggleToInternalLabel,
      toggleToPublicLabel,
      pinLabel,
      unpinLabel,
    ]
  );

  return (
    <CommentDisplayContext value={contextValue}>
      {children}
    </CommentDisplayContext>
  );
}
