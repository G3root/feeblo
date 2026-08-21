import type { ReactNode } from "react";
import { createContext, use } from "react";

export type CommentComposerState = {
  /** Picked subject display label; null means the session user authors. */
  authorDisplay: string | null;
  /** Picker UI rendered while `isAuthorMode` is on (see Provider props). */
  authorPicker: ReactNode | null;
  content: string;
  disabled: boolean;
  isAuthorMode: boolean;
  isPrivate: boolean;
  placeholder: string;
  resetKey: number;
  showAuthorToggle: boolean;
  showVisibilityToggle: boolean;
};

export type CommentComposerActions = {
  onCancel?: () => void;
  onAuthorToggle?: (pressed: boolean) => void;
  onContentChange: (content: string) => void;
  onSubmit?: () => void;
  onVisibilityChange: (isPrivate: boolean) => void;
};

export type CommentComposerMeta = {
  cancelLabel: string;
  privateLabel: string;
  publicLabel: string;
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
