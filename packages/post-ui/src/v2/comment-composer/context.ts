import { createContext, use } from "react";

export type CommentComposerState = {
  content: string;
  disabled: boolean;
  isPrivate: boolean;
  placeholder: string;
  resetKey: number;
  showVisibilityToggle: boolean;
};

export type CommentComposerActions = {
  onCancel?: () => void;
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
