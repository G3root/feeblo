import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
import { createContext, use } from "react";

import { useCommentComposerState } from "./store";

/** One selectable post status in the "comment as status update" picker. */
export type TPostStatusOption = {
  /** Org-scoped post_status id (foreign key stored on the comment). */
  id: string;
  /** Post-status type vocabulary value (e.g. "COMPLETED"). */
  type: TPostStatusType;
  /** Human-readable label (e.g. "Completed"). */
  label: string;
};

/**
 * Prop-derived state only. Mutable composer state (content, visibility,
 * status update, reset counter, submit-in-flight) lives in the xstate store;
 * select it with `useCommentComposerState` so components re-render only when
 * the slices they use actually change.
 */
export type CommentComposerState = {
  disabled: boolean;
  placeholder: string | undefined;
  showVisibilityToggle: boolean;
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

/**
 * The composer is inert while the host disables it or while a submit started
 * by the composer itself is still in flight.
 */
export function useCommentComposerIsDisabled(): boolean {
  const { state } = useCommentComposer();
  const isSubmitting = useCommentComposerState(
    (context) => context.isSubmitting
  );

  return state.disabled || isSubmitting;
}

export function useCommentComposerPlaceholder(): string {
  const { state } = useCommentComposer();
  const isPrivate = useCommentComposerState((context) => context.isPrivate);

  return (
    state.placeholder ??
    (isPrivate ? "Add an internal note..." : "Add a comment...")
  );
}
