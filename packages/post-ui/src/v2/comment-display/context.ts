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
};

export type CommentDisplayActions = {
  onCancelEdit: () => void;
  onDelete: () => void;
  onReply: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  onStartEdit: () => void;
  onToggleVisibility: () => void;
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
};

export type CommentDisplayContextValue = {
  actions: CommentDisplayActions;
  meta: CommentDisplayMeta;
  state: CommentDisplayState;
};

export const CommentDisplayContext = createContext<CommentDisplayContextValue | null>(
  null
);

export function useCommentDisplay() {
  const value = use(CommentDisplayContext);

  if (!value) {
    throw new Error("CommentDisplay components must be used within Provider.");
  }

  return value;
}