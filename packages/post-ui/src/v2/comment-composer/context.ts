import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
import type { ReactNode } from "react";
import { createContext, use } from "react";

import { m } from "../../paraglide/messages.js";
import { useCommentComposerState } from "./store";

/** One selectable post status in the "comment as status update" picker. */
export type TPostStatusOption = {
  /** Org-scoped post_status id (foreign key stored on the comment). */
  id: string;
  /** Post-status type vocabulary value (e.g. "COMPLETED"). */
  type: TPostStatusType;
  /** Human-readable label (e.g. "Completed"). */
  label: string;
  /** Status color (oklch string) when the org set a custom one. */
  color?: string | null;
};

/**
 * Prop-derived state only. Mutable composer state (content, visibility,
 * status update, reset counter, submit-in-flight) lives in the xstate store;
 * select it with `useCommentComposerState` so components re-render only when
 * the slices they use actually change.
 */
export type CommentComposerState = {
  /** Picked subject display label; null means the session user authors. */
  authorDisplay: string | null;
  /** Picker UI rendered in the options popover's author section. */
  authorPicker: ReactNode | null;
  disabled: boolean;
  /**
   * Host-owned pending state for composers that submit through a native form
   * (e.g. a TanStack form's `isSubmitting`). The provider-driven `onSubmit`
   * path keeps its pending state in the store instead.
   */
  isSubmitting: boolean;
  placeholder: string | undefined;
  showAuthorToggle: boolean;
  showVisibilityToggle: boolean;
  /** Options rendered in the "comment as status update" picker. */
  statusOptions: readonly TPostStatusOption[];
};

export type CommentComposerActions = {
  /**
   * Stages a freshly named subject as the on-behalf author. A host that
   * persists the subject before it can be selected returns a promise; the
   * create-subject dialog waits on it before closing.
   */
  onAuthorCreate?: (values: {
    email: string;
    name: string;
  }) => void | Promise<void>;
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
 * The composer is inert while the host disables it, while a host-owned
 * native-form submit is in flight, or while a submit started by the composer
 * itself is still in flight.
 */
export function useCommentComposerIsDisabled(): boolean {
  const { state } = useCommentComposer();
  const isStoreSubmitting = useCommentComposerState(
    (context) => context.isSubmitting
  );

  return state.disabled || state.isSubmitting || isStoreSubmitting;
}

export function useCommentComposerPlaceholder(): string {
  const { state } = useCommentComposer();
  const isPrivate = useCommentComposerState((context) => context.isPrivate);

  return (
    state.placeholder ??
    (isPrivate ? m.patient_active_mammoth() : m.actual_safe_impala())
  );
}
