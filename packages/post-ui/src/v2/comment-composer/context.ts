import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
import { createContext, use } from "react";

/** One selectable post status in the "comment as status update" picker. */
export type TPostStatusOption = {
  /** Org-scoped post_status id (foreign key stored on the comment). */
  id: string;
  /** Post-status type vocabulary value (e.g. "COMPLETED"). */
  type: TPostStatusType;
  /** Human-readable label (e.g. "Completed"). */
  label: string;
};

export type CommentComposerState = {
  content: string;
  disabled: boolean;
  isPrivate: boolean;
  placeholder: string;
  resetKey: number;
  showVisibilityToggle: boolean;
  /** Post status (FK id) this comment moves the post to; null = plain comment. */
  statusUpdateId: string | null;
  /** Options rendered in the "comment as status update" picker. */
  statusOptions: readonly TPostStatusOption[];
};

export type CommentComposerActions = {
  onCancel?: () => void;
  onContentChange: (content: string) => void;
  onSubmit?: () => void;
  onVisibilityChange: (isPrivate: boolean) => void;
  /** Clears the status update when called with null. */
  onStatusUpdateIdChange: (id: string | null) => void;
};

export type CommentComposerMeta = {
  cancelLabel: string;
  privateLabel: string;
  publicLabel: string;
  statusUpdateLabel: string;
  submitLabel?: string;
};

export type CommentComposerContextValue = {
  actions: CommentComposerActions;
  meta: CommentComposerMeta;
  state: CommentComposerState;
};

export const CommentComposerContext =
  createContext<CommentComposerContextValue | null>(null);

export function useCommentComposer() {
  const value = use(CommentComposerContext);

  if (!value) {
    throw new Error("CommentComposer components must be used within Provider.");
  }

  return value;
}
