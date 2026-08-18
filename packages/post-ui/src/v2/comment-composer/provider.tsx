import { type ReactNode, useMemo } from "react";

import {
  CommentComposerContext,
  type CommentComposerContextValue,
} from "./context";

export type CommentComposerProviderProps = {
  children?: ReactNode;
  cancelLabel?: string;
  content?: string;
  disabled?: boolean;
  isPrivate?: boolean;
  onCancel?: () => void;
  onContentChange?: (content: string) => void;
  onSubmit?: () => void;
  onVisibilityChange?: (isPrivate: boolean) => void;
  placeholder?: string;
  privateLabel?: string;
  publicLabel?: string;
  resetKey?: number;
  showVisibilityToggle?: boolean;
  submitLabel?: string;
};

export function CommentComposerProvider({
  children,
  cancelLabel = "Cancel",
  content = "",
  disabled = false,
  isPrivate = false,
  onCancel,
  onContentChange,
  onSubmit,
  onVisibilityChange,
  placeholder,
  privateLabel = "Internal",
  publicLabel = "Public",
  resetKey = 0,
  showVisibilityToggle = true,
  submitLabel,
}: CommentComposerProviderProps) {
  const contextValue = useMemo<CommentComposerContextValue>(
    () => ({
      actions: {
        onCancel,
        onContentChange: onContentChange ?? (() => {}),
        onSubmit,
        onVisibilityChange: onVisibilityChange ?? (() => {}),
      },
      meta: { cancelLabel, privateLabel, publicLabel, submitLabel },
      state: {
        content,
        disabled,
        isPrivate,
        placeholder:
          placeholder ??
          (isPrivate ? "Add an internal note..." : "Add a comment..."),
        resetKey,
        showVisibilityToggle,
      },
    }),
    [
      cancelLabel,
      content,
      disabled,
      isPrivate,
      onCancel,
      onContentChange,
      onSubmit,
      onVisibilityChange,
      placeholder,
      privateLabel,
      publicLabel,
      resetKey,
      showVisibilityToggle,
      submitLabel,
    ]
  );

  return (
    <CommentComposerContext value={contextValue}>
      {children}
    </CommentComposerContext>
  );
}
