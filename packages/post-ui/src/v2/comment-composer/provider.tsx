import type { ReactNode } from "react";
import { useMemo } from "react";

import {
  CommentComposerContext,
  type CommentComposerContextValue,
} from "./context";

export type CommentComposerProviderProps = {
  children?: ReactNode;
  /** Display label of the picked on-behalf subject; null = session user. */
  authorDisplay?: string | null;
  /** Picker UI shown while `isAuthorMode` is on. */
  authorPicker?: ReactNode;
  cancelLabel?: string;
  content?: string;
  disabled?: boolean;
  isAuthorMode?: boolean;
  isPrivate?: boolean;
  onCancel?: () => void;
  onAuthorToggle?: (pressed: boolean) => void;
  onContentChange?: (content: string) => void;
  onSubmit?: () => void;
  onVisibilityChange?: (isPrivate: boolean) => void;
  placeholder?: string;
  privateLabel?: string;
  publicLabel?: string;
  resetKey?: number;
  /** Whether the "comment as customer" toggle is rendered at all. */
  showAuthorToggle?: boolean;
  showVisibilityToggle?: boolean;
  submitLabel?: string;
};

export function CommentComposerProvider({
  children,
  authorDisplay = null,
  authorPicker = null,
  cancelLabel = "Cancel",
  content = "",
  disabled = false,
  isAuthorMode = false,
  isPrivate = false,
  onCancel,
  onAuthorToggle,
  onContentChange,
  onSubmit,
  onVisibilityChange,
  placeholder,
  privateLabel = "Internal",
  publicLabel = "Public",
  resetKey = 0,
  showAuthorToggle = false,
  showVisibilityToggle = true,
  submitLabel,
}: CommentComposerProviderProps) {
  const contextValue = useMemo<CommentComposerContextValue>(
    () => ({
      actions: {
        onCancel,
        onAuthorToggle,
        onContentChange: onContentChange ?? (() => {}),
        onSubmit,
        onVisibilityChange: onVisibilityChange ?? (() => {}),
      },
      meta: { cancelLabel, privateLabel, publicLabel, submitLabel },
      state: {
        authorDisplay,
        authorPicker,
        content,
        disabled,
        isAuthorMode,
        isPrivate,
        placeholder:
          placeholder ??
          (isPrivate ? "Add an internal note..." : "Add a comment..."),
        resetKey,
        showAuthorToggle,
        showVisibilityToggle,
      },
    }),
    [
      authorDisplay,
      authorPicker,
      cancelLabel,
      content,
      disabled,
      isAuthorMode,
      isPrivate,
      onCancel,
      onAuthorToggle,
      onContentChange,
      onSubmit,
      onVisibilityChange,
      placeholder,
      privateLabel,
      publicLabel,
      resetKey,
      showAuthorToggle,
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
